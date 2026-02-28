import cors from '@fastify/cors';
import Fastify from 'fastify';
import { createWordPressClientFromEnv } from '@bisp/integrations-wordpress';
import { AssistanceAgent } from '@bisp/agents-assistance';
import { ComplianceAgent } from '@bisp/agents-compliance';
import { ContentAgent } from '@bisp/agents-content';
import { CustomerCareAgent } from '@bisp/agents-customer-care';
import { EnergyAgent } from '@bisp/agents-energy';
import { HardwareAgent } from '@bisp/agents-hardware';
import { PreventiviAgent } from '@bisp/agents-preventivi';
import { TelephonyAgent } from '@bisp/agents-telephony';
import { AssistanceRepository } from '@bisp/domain-assistance';
import { OutboxRepository } from '@bisp/domain-communications';
import { CustomerRepository } from '@bisp/domain-customers';
import { ObjectiveRepository } from '@bisp/domain-objectives';
import { OfferRepository } from '@bisp/domain-offers';
import { DaneaReadOnlyStub } from '@bisp/integrations-danea';
import { ElizaPublishingAdapterStub, InMemoryRAGStore } from '@bisp/integrations-eliza';
import { createLLMClient, type LLMClient } from '@bisp/integrations-llm';
import { EmailChannelAdapter } from '@bisp/integrations-email';
import { MediaGenerationServiceStub } from '@bisp/integrations-media';
import { SocialChannelAdapter } from '@bisp/integrations-social';
import { TelegramChannelAdapter } from '@bisp/integrations-telegram';
import { WhatsAppChannelAdapter } from '@bisp/integrations-whatsapp';
import { CopilotRMOrchestrator } from '@bisp/orchestrator-core';
import { SwarmRuntime } from '@bisp/domain-swarm';
import { AgentDiscussion } from '@bisp/agent-bus';
import { AuditTrail, makeAuditRecord } from '@bisp/shared-audit';
import { PgRuntime } from '@bisp/shared-db';
import type {
  AssistanceTicket,
  CommunicationDraft,
  ContentCard,
  CustomerProfile,
  DomainEvent,
  ManagerObjective,
  ProductOffer,
  Segment,
  TaskItem,
} from '@bisp/shared-types';
import { loadConfig } from '@bisp/shared-config';
import { ROLE_PERMISSIONS, can, type RbacRole } from '@bisp/shared-rbac';
import { demoCustomers, demoObjectives, demoOffers } from './demoData';
import { AdminSettingsRepository } from './admin/settings';
import { CharacterStudioRepository } from './admin/characters';
import { CampaignRepository, ContentCardRepository, ConversationRepository, OutboxStore, TaskRepository } from './localRepos';
import type { ChannelDispatchRecord, MediaJobRecord } from './postgresMirror';
import { PostgresMirror } from './postgresMirror';
import { QueueGateway } from './queueGateway';
import { scenarioFactory } from './scenarioFactory';
import {
  buildCampaignTasks,
  buildOneToManyDraftsForOffer,
  buildOneToOneDraftsForOffer,
  buildRagStore,
  consultProposal,
  makeId,
  targetCustomersForOffer,
} from './services';

export interface ApiState {
  contentCards: ContentCardRepository;
  conversations: ConversationRepository;
  assistance: AssistanceRepository;
  campaigns: CampaignRepository;
  customers: CustomerRepository;
  danea: DaneaReadOnlyStub;
  drafts: OutboxStore;
  draftsRaw: OutboxRepository;
  offers: OfferRepository;
  objectives: ObjectiveRepository;
  rag: InMemoryRAGStore;
  audit: AuditTrail;
  adminSettings: AdminSettingsRepository;
  characterStudio: CharacterStudioRepository;
  orchestrator: CopilotRMOrchestrator;
  tasks: TaskRepository;
  channels: {
    telegram: TelegramChannelAdapter;
    email: EmailChannelAdapter;
    social: SocialChannelAdapter;
    whatsapp: WhatsAppChannelAdapter;
    elizaPublishing: ElizaPublishingAdapterStub;
  };
  media: MediaGenerationServiceStub;
  postgresMirror: PostgresMirror;
  queueGateway: QueueGateway;
  llm: LLMClient | null;
  swarmRuntime: SwarmRuntime;
}

export function buildState(seed?: { customers?: CustomerProfile[]; offers?: ProductOffer[]; objectives?: ManagerObjective[] }): ApiState {
  const contentCards = new ContentCardRepository();
  const conversations = new ConversationRepository();
  const assistance = new AssistanceRepository();
  const campaigns = new CampaignRepository();
  const customers = new CustomerRepository();
  const danea = new DaneaReadOnlyStub();
  const drafts = new OutboxStore();
  const draftsRaw = new OutboxRepository();
  const offers = new OfferRepository();
  const objectives = new ObjectiveRepository();
  const tasks = new TaskRepository();
  const audit = new AuditTrail();
  const adminSettings = new AdminSettingsRepository();
  const characterStudio = new CharacterStudioRepository();
  const postgresMirror = new PostgresMirror({
    enabled: /^(postgres|hybrid)$/i.test(process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory'),
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm',
  });
  const queueGateway = new QueueGateway(
    /^(redis|bullmq)$/i.test(process.env.BISPCRM_QUEUE_MODE ?? 'inline') ? 'redis' : 'inline',
    process.env.REDIS_URL ?? 'redis://localhost:6379'
  );

  // LLM client — local-first con cloud fallback; null se nessun provider configurato
  let llm: LLMClient | null = null;
  try {
    const appConfig = loadConfig();
    llm = createLLMClient(appConfig.llm);
  } catch {
    // fallback graceful: sistema funziona con template string
  }

  for (const c of seed?.customers ?? demoCustomers) customers.upsert(c);
  for (const o of seed?.offers ?? demoOffers) offers.upsert(o);
  for (const obj of seed?.objectives ?? demoObjectives) objectives.upsert(obj);
  const rag = buildRagStore(customers.list(), offers.listActive());
  customers.list().forEach((c) => void postgresMirror.saveCustomer(c));
  offers.listAll().forEach((o) => void postgresMirror.saveOffer(o));
  objectives.listAll().forEach((o) => void postgresMirror.saveObjective(o));

  const orchestrator = new CopilotRMOrchestrator([
    new AssistanceAgent(),
    new PreventiviAgent(),
    new TelephonyAgent(),
    new EnergyAgent(),
    new HardwareAgent(),
    new CustomerCareAgent(),
    new ContentAgent(),
    new ComplianceAgent(),
  ]);

  return {
    contentCards,
    conversations,
    assistance,
    campaigns,
    customers,
    danea,
    drafts,
    draftsRaw,
    offers,
    objectives,
    rag,
    audit,
    adminSettings,
    characterStudio,
    orchestrator,
    tasks,
    channels: {
      telegram: new TelegramChannelAdapter(),
      email: new EmailChannelAdapter(),
      social: new SocialChannelAdapter(),
      whatsapp: new WhatsAppChannelAdapter(),
      elizaPublishing: new ElizaPublishingAdapterStub(),
    },
    media: new MediaGenerationServiceStub(),
    postgresMirror,
    queueGateway,
    llm,
    swarmRuntime: new SwarmRuntime(),
  };
}

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw);
}

function getDailyContactCap(state: ApiState): number | null {
  const caps = state.objectives.listActive()
    .map((o) => o.dailyContactCapacity)
    .filter((c): c is number => c != null && c > 0);
  return caps.length > 0 ? Math.min(...caps) : null;
}

function countTodayOneToOneDispatched(state: ApiState): number {
  const today = new Date().toDateString();
  return state.drafts.list().filter((i) => {
    if (i.draft.audience !== 'one-to-one') return false;
    if (i.status === 'rejected') return false;
    const d = i.createdAt ? new Date(i.createdAt).toDateString() : today; // created today = counts
    return d === today;
  }).length;
}

/**
 * Genera uno .zip in-memory contenente il plugin WordPress CopilotRM.
 * Formato: ZIP con un singolo entry PHP + readme.
 * Usa formato ZIP senza compressione (store) per semplicità, no dipendenze esterne.
 */
function buildWordPressPluginZip(apiUrl: string): Buffer {
  const pluginSlug = 'copilotrm-connector';
  const phpContent = `<?php
/**
 * Plugin Name: CopilotRM Connector
 * Plugin URI: ${apiUrl}
 * Description: Connette WordPress a CopilotRM. Registra automaticamente il sito e permette la pubblicazione di articoli dall'agente redattore.
 * Version: 1.0.0
 * Author: CopilotRM
 * License: MIT
 */
if (!defined('ABSPATH')) exit;

define('COPILOTRM_API_URL', '${apiUrl}');
define('COPILOTRM_SECRET_OPTION', 'copilotrm_plugin_secret');

// Registrazione automatica all'attivazione del plugin
register_activation_hook(__FILE__, 'copilotrm_activate');
function copilotrm_activate() {
    $secret = get_option(COPILOTRM_SECRET_OPTION);
    if (!$secret) {
        $secret = wp_generate_password(32, false);
        update_option(COPILOTRM_SECRET_OPTION, $secret);
    }
    $site_url = get_site_url();
    $site_title = get_bloginfo('name');
    $payload = json_encode(['wpUrl' => $site_url, 'secret' => $secret, 'siteTitle' => $site_title]);
    wp_remote_post(COPILOTRM_API_URL . '/api/integrations/wordpress/register', [
        'headers' => ['Content-Type' => 'application/json'],
        'body'    => $payload,
        'timeout' => 15,
    ]);
}

// REST API: POST /wp-json/copilotrm/v1/articles
add_action('rest_api_init', function () {
    register_rest_route('copilotrm/v1', '/articles', [
        'methods'             => 'POST',
        'callback'            => 'copilotrm_create_article',
        'permission_callback' => 'copilotrm_auth_check',
    ]);
});

function copilotrm_auth_check(WP_REST_Request \$request) {
    $secret = get_option(COPILOTRM_SECRET_OPTION);
    return \$request->get_header('X-CopilotRM-Secret') === \$secret;
}

function copilotrm_create_article(WP_REST_Request \$request) {
    \$params = \$request->get_json_params();
    \$title   = sanitize_text_field(\$params['title'] ?? '');
    \$content = wp_kses_post(\$params['content'] ?? '');
    \$excerpt = sanitize_textarea_field(\$params['excerpt'] ?? '');
    \$status  = in_array(\$params['status'] ?? 'draft', ['publish', 'draft', 'pending']) ? \$params['status'] : 'draft';

    if (!$title || !$content) {
        return new WP_Error('missing_fields', 'title e content obbligatori', ['status' => 400]);
    }

    \$post_id = wp_insert_post([
        'post_title'   => \$title,
        'post_content' => \$content,
        'post_excerpt' => \$excerpt,
        'post_status'  => \$status,
        'post_type'    => 'post',
    ]);

    if (is_wp_error(\$post_id)) {
        return new WP_Error('insert_failed', \$post_id->get_error_message(), ['status' => 500]);
    }

    // Featured image da URL
    if (!empty(\$params['imageUrl'])) {
        \$image_id = copilotrm_sideload_image(\$params['imageUrl'], \$post_id);
        if (\$image_id && !is_wp_error(\$image_id)) {
            set_post_thumbnail(\$post_id, \$image_id);
        }
    }

    return ['ok' => true, 'postId' => \$post_id, 'link' => get_permalink(\$post_id)];
}

function copilotrm_sideload_image(\$url, \$post_id) {
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';
    \$tmp = download_url(\$url);
    if (is_wp_error(\$tmp)) return \$tmp;
    \$file = ['name' => basename(parse_url(\$url, PHP_URL_PATH)), 'tmp_name' => \$tmp];
    return media_handle_sideload(\$file, \$post_id);
}
`;

  // Build minimal ZIP (store, no compression) manually
  const encoder = new TextEncoder();
  const fileName = `${pluginSlug}/${pluginSlug}.php`;
  const fileData = Buffer.from(phpContent, 'utf-8');
  const fileNameBuf = Buffer.from(fileName, 'utf-8');

  function crc32(buf: Buffer): number {
    const table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
      }
      return t;
    })();
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  const crc = crc32(fileData);
  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

  // Local file header
  const lfh = Buffer.alloc(30 + fileNameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0); // signature
  lfh.writeUInt16LE(20, 4);         // version needed
  lfh.writeUInt16LE(0, 6);          // flags
  lfh.writeUInt16LE(0, 8);          // compression: store
  lfh.writeUInt16LE(dosTime, 10);
  lfh.writeUInt16LE(dosDate, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(fileData.length, 18); // compressed size
  lfh.writeUInt32LE(fileData.length, 22); // uncompressed size
  lfh.writeUInt16LE(fileNameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  fileNameBuf.copy(lfh, 30);

  const localOffset = 0;

  // Central directory header
  const cdh = Buffer.alloc(46 + fileNameBuf.length);
  cdh.writeUInt32LE(0x02014b50, 0); // signature
  cdh.writeUInt16LE(20, 4);         // version made by
  cdh.writeUInt16LE(20, 6);         // version needed
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);         // compression: store
  cdh.writeUInt16LE(dosTime, 12);
  cdh.writeUInt16LE(dosDate, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(fileData.length, 20);
  cdh.writeUInt32LE(fileData.length, 24);
  cdh.writeUInt16LE(fileNameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);         // extra
  cdh.writeUInt16LE(0, 32);         // comment
  cdh.writeUInt16LE(0, 34);         // disk start
  cdh.writeUInt16LE(0, 36);         // int attr
  cdh.writeUInt32LE(0, 38);         // ext attr
  cdh.writeUInt32LE(localOffset, 42); // local header offset
  fileNameBuf.copy(cdh, 46);

  const cdhOffset = lfh.length + fileData.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);         // total entries this disk
  eocd.writeUInt16LE(1, 10);        // total entries
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(cdhOffset, 16);
  eocd.writeUInt16LE(0, 20);

  void encoder; // suppress unused warning
  return Buffer.concat([lfh, fileData, cdh, eocd]);
}

// ── Chat Orchestration: discussione multi-agente strutturata ─────────────────

/** Tipo di un singolo messaggio nel thread visibile della chat */
export interface ChatSwarmMsg {
  agent: string;
  agentRole: string;
  content: string;
  kind: 'brief' | 'analysis' | 'critique' | 'defense' | 'synthesis';
  mentions: string[];
  round: number;
}

/**
 * Mappa nome-display-agente → chiave Character Studio.
 * Permette di leggere il profilo persona reale da CharacterStudioRepository.
 */
const AGENT_CHARACTER_KEY: Record<string, string> = {
  Assistenza:   'assistance',
  Commerciale:  'preventivi',
  Hardware:     'hardware',
  Telefonia:    'telephony',
  Energia:      'energy',
  CustomerCare: 'customerCare',
  Critico:      'critico',
  Moderatore:   'moderatore',
  Orchestratore:'orchestratore',
};

/** Nomi agente → categorie offerta rilevanti per il dominio */
const AGENT_OFFER_CATEGORIES: Record<string, Array<ProductOffer['category']>> = {
  Commerciale:  ['hardware', 'smartphone', 'connectivity', 'service', 'energy', 'accessory'],
  Hardware:     ['hardware', 'smartphone', 'accessory'],
  Telefonia:    ['connectivity'],
  Energia:      ['energy'],
  Assistenza:   ['service', 'accessory'],
};

/** Agenti che possono essere invocati nella chat swarm */
const CHAT_AGENTS_LIST = ['Assistenza', 'Commerciale', 'Hardware', 'Telefonia', 'Energia', 'CustomerCare'];

interface LLMClientLike {
  chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: { tier?: 'small' | 'medium' | 'large'; maxTokens?: number; temperature?: number }
  ): Promise<{ content: string; provider: string; model?: string }>;
}

/** SSE event types emitted by /api/chat */
export type ChatSSEEvent =
  | { type: 'typing'; agent: string; agentRole: string }
  | { type: 'message'; msg: ChatSwarmMsg }
  | { type: 'done'; synthesis: string; swarmRunId: string | null; sessionId: string; customer: { id: string; fullName: string; segments: string[] } | null }
  | { type: 'error'; message: string };

/** Costruisce il system prompt per un agente leggendo il profilo da Character Studio */
function buildAgentSystemPrompt(agentName: string, characterStudio: CharacterStudioRepository): { prompt: string; role: string } {
  const key = AGENT_CHARACTER_KEY[agentName];
  const profile = key ? characterStudio.get(key) : undefined;
  if (profile) {
    const parts = [
      `Sei ${profile.name}, ${profile.role} in CopilotRM.`,
      profile.tone.length ? `Tono: ${profile.tone.join(', ')}.` : '',
      profile.goals.length ? `Obiettivi: ${profile.goals.join('; ')}.` : '',
      profile.limits.length ? `Limiti: ${profile.limits.join('; ')}.` : '',
      profile.systemInstructions || '',
      'Rispondi in italiano.',
    ].filter(Boolean).join(' ');
    return { prompt: parts, role: profile.role };
  }
  const fallbackRole = 'agente specialistico CopilotRM';
  return {
    prompt: `Sei ${agentName}, ${fallbackRole}. Rispondi in modo preciso e orientato all'azione. Rispondi in italiano.`,
    role: fallbackRole,
  };
}

/** Costruisce il contesto dati CRM specifico per ogni agente */
function buildAgentDataContext(
  agentName: string,
  customer: CustomerProfile | undefined,
  customerTickets: AssistanceTicket[],
  activeOffers: ProductOffer[],
  activeObjectives: ManagerObjective[]
): string {
  const lines: string[] = [];

  if (customer) {
    lines.push('=== DATI CLIENTE ===');
    lines.push(`Nome: ${customer.fullName} | ID: ${customer.id}`);
    if (customer.segments.length) lines.push(`Segmenti: ${customer.segments.join(', ')}`);
    if (customer.interests.length) lines.push(`Interessi: ${customer.interests.join(', ')}`);
    if (customer.spendBand) lines.push(`Fascia spesa: ${customer.spendBand}`);
    if (customer.purchaseHistory.length) lines.push(`Acquisti: ${customer.purchaseHistory.slice(0, 3).join(' | ')}`);
    if (customer.conversationNotes.length) lines.push(`Note: ${customer.conversationNotes.slice(0, 2).join(' | ')}`);
    lines.push(`Saturazione comm.: ${customer.commercialSaturationScore}/10`);
  }

  // Ticket assistenza (per Assistenza + tutti gli agenti come contesto)
  if (customerTickets.length > 0) {
    lines.push('\n=== TICKET ASSISTENZA ===');
    customerTickets.slice(0, 4).forEach((t) => {
      lines.push(`- [${t.createdAt.slice(0, 10)}] ${t.deviceType}: ${t.issue} | Esito: ${t.outcome ?? 'in attesa'}`);
      if (t.diagnosis) lines.push(`  Diagnosi: ${t.diagnosis}`);
      if (t.inferredSignals.length) lines.push(`  Segnali: ${t.inferredSignals.join(', ')}`);
    });
  }

  // Offerte per agenti commerciali/tecnici
  const offerCats = AGENT_OFFER_CATEGORIES[agentName];
  if (offerCats) {
    const relevantOffers = activeOffers.filter((o) => offerCats.includes(o.category)).slice(0, 6);
    if (relevantOffers.length > 0) {
      lines.push('\n=== OFFERTE DISPONIBILI ===');
      relevantOffers.forEach((o) => {
        const price = o.suggestedPrice != null ? `€${o.suggestedPrice}` : 'prezzo n.d.';
        const margin = o.marginPct != null ? `margine ${o.marginPct}%` : '';
        const stock = o.stockQty != null ? `stock ${o.stockQty}` : '';
        lines.push(`- ${o.title} | ${price}${margin ? ' | ' + margin : ''}${stock ? ' | ' + stock : ''}`);
        if (o.targetSegments.length) lines.push(`  Segmenti target: ${o.targetSegments.join(', ')}`);
      });
    }
  }

  // Obiettivi manager (per agenti commerciali)
  if (['Commerciale', 'Telefonia', 'Energia', 'Hardware'].includes(agentName) && activeObjectives.length > 0) {
    lines.push('\n=== OBIETTIVI MANAGER ===');
    activeObjectives.slice(0, 2).forEach((obj) => {
      lines.push(`- ${obj.name}`);
      const weights = Object.entries(obj.categoryWeights).map(([k, v]) => `${k}:${v}`).join(', ');
      if (weights) lines.push(`  Pesi categorie: ${weights}`);
      if (obj.minMarginPct) lines.push(`  Margine minimo: ${obj.minMarginPct}%`);
      if (obj.dailyContactCapacity) lines.push(`  Cap contatti/giorno: ${obj.dailyContactCapacity}`);
    });
  }

  return lines.join('\n');
}

function extractMentions(text: string): string[] {
  return [...new Set((text.match(/@([A-Za-zÀ-ù]+)/g) ?? []).map((m) => m.slice(1)).filter((a) => CHAT_AGENTS_LIST.includes(a)))];
}

/**
 * Orchestrazione chat multi-agente con dati CRM reali e profili Character Studio.
 * Pipeline SEQUENZIALE (ogni agente vede l'output dei precedenti):
 * 1. Orchestratore → brief con @mentions
 * 2. Agenti coinvolti → risposta sequenziale, ognuno vede chi ha parlato prima
 * 3. Agenti extra taggati → rispondono con contesto completo
 * 4. Critico → adversarial review sui dati reali
 * 5. Difesa → agenti sfidati si difendono
 * 6. Moderatore → sintesi finale (NON nel thread, solo come `synthesis`)
 *
 * Callbacks onTyping/onMessage permettono streaming SSE al frontend.
 */
async function runChatOrchestration(params: {
  llm: LLMClientLike;
  message: string;
  customer: CustomerProfile | undefined;
  customerTickets: AssistanceTicket[];
  activeOffers: ProductOffer[];
  activeObjectives: ManagerObjective[];
  characterStudio: CharacterStudioRepository;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Chiamato immediatamente PRIMA che l'agente venga interrogato */
  onTyping?: (agent: string, agentRole: string) => void;
  /** Chiamato immediatamente DOPO che l'agente risponde */
  onMessage?: (msg: ChatSwarmMsg) => void;
}): Promise<{ thread: ChatSwarmMsg[]; synthesis: string }> {
  const { llm, message, customer, customerTickets, activeOffers, activeObjectives, characterStudio, conversationHistory, onTyping, onMessage } = params;
  const thread: ChatSwarmMsg[] = [];
  const agentResponses: Record<string, string> = {};

  const sharedDataCtx = buildAgentDataContext('Orchestratore', customer, customerTickets, activeOffers, activeObjectives);
  const agentList = CHAT_AGENTS_LIST.map((n) => {
    const key = AGENT_CHARACTER_KEY[n];
    const p = key ? characterStudio.get(key) : undefined;
    return `@${n} (${p?.role ?? n.toLowerCase()})`;
  }).join('; ');

  const historyCtx = conversationHistory && conversationHistory.length > 0
    ? '\n=== CRONOLOGIA RECENTE ===\n' + conversationHistory.slice(-6).map((m) => `${m.role === 'user' ? 'Operatore' : 'CopilotRM'}: ${m.content.slice(0, 100)}`).join('\n')
    : '';

  // Helper: snapshot testuale della discussione corrente per il contesto sequenziale
  const threadSummary = () => thread.length > 0
    ? '\n=== DISCUSSIONE IN CORSO ===\n' + thread.map((m) => `[${m.agent}]: ${m.content}`).join('\n')
    : '';

  // ── Step 1: Orchestratore ────────────────────────────────────────────────────
  const { prompt: orchPrompt, role: orchRole } = buildAgentSystemPrompt('Orchestratore', characterStudio);
  let orchestratorBrief = '';
  let involvedAgents: string[] = [];

  onTyping?.('Orchestratore', orchRole);
  try {
    const resp = await llm.chat([
      { role: 'system', content: `${orchPrompt}\n\nAgenti disponibili: ${agentList}.` },
      { role: 'user', content: `Richiesta operatore: "${message}"${historyCtx}\n\n${sharedDataCtx}` },
    ], { tier: 'small', maxTokens: 180 });
    orchestratorBrief = resp.content.trim();
    involvedAgents = extractMentions(orchestratorBrief);
    if (involvedAgents.length === 0) {
      involvedAgents = customerTickets.length > 0 ? ['Assistenza', 'Commerciale'] : ['Commerciale', 'CustomerCare'];
    }
  } catch {
    orchestratorBrief = `@Assistenza @Commerciale — Analizzare la richiesta: "${message}".${customer ? ` Cliente: ${customer.fullName}.` : ''}`;
    involvedAgents = ['Assistenza', 'Commerciale'];
  }

  const orchMsg: ChatSwarmMsg = { agent: 'Orchestratore', agentRole: orchRole, content: orchestratorBrief, kind: 'brief', mentions: involvedAgents, round: 0 };
  thread.push(orchMsg);
  onMessage?.(orchMsg);

  // ── Step 2: Agenti coinvolti — SEQUENZIALI (ognuno vede chi ha parlato prima) ─
  const extraAgentsCalled = new Set<string>();

  for (const agentName of involvedAgents) {
    const { prompt: sysPrompt, role: agentRole } = buildAgentSystemPrompt(agentName, characterStudio);
    const domainData = buildAgentDataContext(agentName, customer, customerTickets, activeOffers, activeObjectives);

    onTyping?.(agentName, agentRole);
    let content = `[${agentName} non disponibile]`;
    try {
      const resp = await llm.chat([
        {
          role: 'system',
          content: `${sysPrompt}\n\nRispondi al brief dell'Orchestratore basandoti sui dati reali (max 80 parole). Sii diretto. Puoi taggare un altro agente con @NomeAgente se necessario.`,
        },
        { role: 'user', content: `Brief: ${orchestratorBrief}${threadSummary()}\n\n${domainData}` },
      ], { tier: 'small', maxTokens: 160 });
      content = resp.content.trim();
    } catch { /* usa fallback */ }

    agentResponses[agentName] = content;
    const mentions = extractMentions(content).filter((a) => !involvedAgents.includes(a));
    mentions.forEach((m) => extraAgentsCalled.add(m));
    const msg: ChatSwarmMsg = { agent: agentName, agentRole, content, kind: 'analysis', mentions, round: 1 };
    thread.push(msg);
    onMessage?.(msg);
  }

  // ── Step 3: Agenti extra taggati — sequenziali ──────────────────────────────
  for (const agentName of [...extraAgentsCalled].slice(0, 2)) {
    const { prompt: sysPrompt, role: agentRole } = buildAgentSystemPrompt(agentName, characterStudio);
    const domainData = buildAgentDataContext(agentName, customer, customerTickets, activeOffers, activeObjectives);

    onTyping?.(agentName, agentRole);
    let content = `[${agentName} non disponibile]`;
    try {
      const resp = await llm.chat([
        { role: 'system', content: `${sysPrompt}\n\nSei stato chiamato dai colleghi. Rispondi al punto che ti riguarda (max 70 parole), cita i dati reali.` },
        { role: 'user', content: `${threadSummary()}\n\n${domainData}` },
      ], { tier: 'small', maxTokens: 140 });
      content = resp.content.trim();
    } catch { /* usa fallback */ }

    agentResponses[agentName] = content;
    const msg: ChatSwarmMsg = { agent: agentName, agentRole, content, kind: 'analysis', mentions: [], round: 1 };
    thread.push(msg);
    onMessage?.(msg);
  }

  // ── Step 4: Critico ──────────────────────────────────────────────────────────
  const { prompt: criticPrompt, role: criticRole } = buildAgentSystemPrompt('Critico', characterStudio);
  let criticContent = '';
  let criticMentions: string[] = [];

  onTyping?.('Critico', criticRole);
  try {
    const resp = await llm.chat([
      { role: 'system', content: criticPrompt },
      { role: 'user', content: `Richiesta: "${message}"\n\n${sharedDataCtx}${threadSummary()}` },
    ], { tier: 'small', maxTokens: 140 });
    criticContent = resp.content.trim();
    criticMentions = extractMentions(criticContent);
  } catch {
    criticContent = '[Critico non disponibile]';
  }

  const criticMsg: ChatSwarmMsg = { agent: 'Critico', agentRole: criticRole, content: criticContent, kind: 'critique', mentions: criticMentions, round: 2 };
  thread.push(criticMsg);
  onMessage?.(criticMsg);

  // ── Step 5: Difesa — sequenziale ────────────────────────────────────────────
  for (const agentName of criticMentions.slice(0, 2)) {
    const { prompt: sysPrompt, role: agentRole } = buildAgentSystemPrompt(agentName, characterStudio);
    const domainData = buildAgentDataContext(agentName, customer, customerTickets, activeOffers, activeObjectives);

    onTyping?.(agentName, agentRole);
    let content = `[${agentName} non disponibile]`;
    try {
      const resp = await llm.chat([
        { role: 'system', content: `${sysPrompt}\n\nIl Critico ha sfidato la tua proposta. Rispondi con i dati reali (max 60 parole). Sii concreto.` },
        { role: 'user', content: `Tua proposta: ${agentResponses[agentName] ?? ''}${threadSummary()}\n\n${domainData}` },
      ], { tier: 'small', maxTokens: 120 });
      content = resp.content.trim();
    } catch { /* usa fallback */ }

    const msg: ChatSwarmMsg = { agent: agentName, agentRole, content, kind: 'defense', mentions: ['Critico'], round: 3 };
    thread.push(msg);
    onMessage?.(msg);
  }

  // ── Step 6: Moderatore — SOLO come synthesis, NON nel thread ────────────────
  const { prompt: modPrompt, role: modRole } = buildAgentSystemPrompt('Moderatore', characterStudio);
  let synthesis = Object.entries(agentResponses).map(([a, c]) => `${a}: ${c}`).join('\n');

  onTyping?.('Moderatore', modRole);
  try {
    const resp = await llm.chat([
      { role: 'system', content: modPrompt },
      { role: 'user', content: `Richiesta: "${message}"\n\n${sharedDataCtx}${threadSummary()}` },
    ], { tier: 'small', maxTokens: 220 });
    synthesis = resp.content.trim();
  } catch { /* usa fallback */ }

  // Moderatore NON viene aggiunto al thread (evita duplicazione con la reply bubble)

  return { thread, synthesis };
}

async function broadcastSwarmDebug(state: ApiState, runId: string, eventType: string, tasksCount: number, draftsCount: number): Promise<void> {
  if (!envFlag('SWARM_DEBUG_TELEGRAM', false)) return;
  try {
    const snap = state.swarmRuntime.snapshot(runId);
    const agentsStr = snap.run?.agentsInvolved?.join(', ') ?? '?';

    // Raggruppa messaggi per kind: prima osservazioni/proposte, poi handoff/decisioni
    const observations = snap.messages.filter((m) => m.kind === 'observation' || m.kind === 'proposal');
    const decisions = snap.messages.filter((m) => m.kind === 'handoff' || m.kind === 'decision');

    const lines: string[] = [`🤖 <b>RUN #${runId.slice(-6)}</b> | <code>${eventType}</code>`];

    if (observations.length > 0) {
      lines.push('\n<b>Analisi agenti:</b>');
      for (const m of observations.slice(0, 4)) {
        const icon = m.kind === 'proposal' ? '💡' : '🔍';
        lines.push(`${icon} <b>${m.fromAgent}</b>: ${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}`);
      }
    }

    if (decisions.length > 0) {
      lines.push('\n<b>Handoff e decisioni:</b>');
      for (const m of decisions.slice(0, 3)) {
        const icon = m.kind === 'handoff' ? '🔀' : '✅';
        const dir = m.toAgent ? ` → ${m.toAgent}` : '';
        lines.push(`${icon} <b>${m.fromAgent}${dir}</b>: ${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}`);
      }
    }

    if (snap.handoffs.length > 0) {
      const execHandoffs = snap.handoffs.filter((h) => h.status === 'executed');
      if (execHandoffs.length > 0) {
        lines.push(`\n<b>Handoff eseguiti:</b> ${execHandoffs.map((h) => `${h.fromAgent}→${h.toAgent}`).join(', ')}`);
      }
    }

    lines.push(`\n📊 ${tasksCount} task | ${draftsCount} draft | agents: ${agentsStr}`);

    const text = lines.join('\n');
    await state.channels.telegram.broadcastToGroups(text);
  } catch { /* best-effort */ }
}

function persistOperationalOutput(state: ApiState, output: { tasks: TaskItem[]; drafts: CommunicationDraft[]; auditRecords: ReturnType<AuditTrail['list']> }) {
  state.tasks.addMany(output.tasks);
  const outboxItems = output.drafts.map((d) => {
    const item = state.drafts.addDraft(d);
    state.draftsRaw.add(d);
    return item;
  });
  output.auditRecords.forEach((r) => state.audit.write(r));
  void state.postgresMirror.saveTasks(output.tasks);
  void state.postgresMirror.saveOutbox(outboxItems);
  void state.postgresMirror.saveAudit(output.auditRecords);
  if (envFlag('BISPCRM_QUEUE_CONTENT_TASKS', false)) {
    output.tasks
      .filter((t) => t.kind === 'content')
      .forEach((t) =>
        void state.queueGateway.enqueueContent({
          taskId: t.id,
          title: t.title,
          offerId: t.offerId ?? null,
          priority: t.priority,
        })
      );
  }
}

function resolveOfferFromRequest(
  state: ApiState,
  body: { offerId?: string; offerTitle?: string }
): ProductOffer | undefined {
  if (body.offerId) {
    if (body.offerId.includes('<') || body.offerId.includes('>')) return undefined;
    return state.offers.getById(body.offerId);
  }
  if (body.offerTitle) {
    const needle = body.offerTitle.trim().toLowerCase();
    return state.offers.listActive().find((o) => o.title.toLowerCase().includes(needle));
  }
  return undefined;
}

function buildChannelDispatchRecord(params: {
  draftId?: string;
  channel: string;
  status: 'queued' | 'sent' | 'failed';
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  error?: string;
}): ChannelDispatchRecord {
  const now = new Date().toISOString();
  return {
    id: makeId('dispatch'),
    source: 'api-core',
    draftId: params.draftId,
    channel: params.channel,
    status: params.status,
    requestPayload: params.requestPayload,
    responsePayload: params.responsePayload,
    error: params.error,
    createdAt: now,
    sentAt: params.status === 'failed' ? undefined : now,
  };
}

export function buildServer(state = buildState()) {
  const app = Fastify({ logger: { level: 'info' } });
  const authMode = (process.env.BISPCRM_AUTH_MODE ?? 'header') as 'none' | 'header';
  const authEnabled = authMode === 'header';
  const resolveRole = (headers: Record<string, unknown>): RbacRole => {
    const raw = String(headers['x-bisp-role'] ?? 'viewer');
    const role = raw as RbacRole;
    return role in ROLE_PERMISSIONS ? role : 'viewer';
  };
  const ensurePermission = (
    req: { headers: Record<string, unknown> },
    reply: { code: (code: number) => { send: (payload: unknown) => unknown } },
    permission: string
  ): RbacRole | null => {
    if (authEnabled && !req.headers['x-bisp-role']) {
      reply.code(401).send({ error: 'Missing x-bisp-role header', authMode });
      return null;
    }
    const role = resolveRole(req.headers);
    if (!authEnabled) return role;
    if (can(role, permission)) return role;
    reply.code(403).send({ error: 'Forbidden', role, permission, authMode });
    return null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void (app as any).register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-bisp-role', 'Accept'],
    exposedHeaders: ['x-bisp-role'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  app.addHook('onReady', async () => {
    const shouldAutoLoad = envFlag(
      'BISPCRM_AUTO_LOAD_RUNTIME',
      /^(postgres|hybrid)$/i.test(process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory')
    );
    if (!shouldAutoLoad) return;
    const [customers, tickets, offers, objectives, tasks, outbox, campaigns, settings] = await Promise.all([
      state.postgresMirror.loadCustomers(),
      state.postgresMirror.loadTickets(),
      state.postgresMirror.loadOffers(),
      state.postgresMirror.loadObjectives(),
      state.postgresMirror.loadTasks(),
      state.postgresMirror.loadOutbox(),
      state.postgresMirror.loadCampaigns(),
      state.postgresMirror.loadAdminSettings(),
    ]);
    if (customers.length) state.customers.replaceAll(customers);
    if (tickets.length) state.assistance.replaceAll(tickets);
    if (offers.length) state.offers.replaceAll(offers);
    if (objectives.length) state.objectives.replaceAll(objectives);
    if (tasks.length) state.tasks.replaceAll(tasks);
    if (outbox.length) state.drafts.replaceAll(outbox);
    if (campaigns.length) state.campaigns.replaceAll(campaigns);
    if (settings.length) state.adminSettings.replaceAll(settings);
    state.rag = buildRagStore(state.customers.list(), state.offers.listActive());
    state.audit.write(
      makeAuditRecord('system', 'db.auto_load_runtime', {
        customers: customers.length,
        tickets: tickets.length,
        offers: offers.length,
        objectives: objectives.length,
        tasks: tasks.length,
        outbox: outbox.length,
        campaigns: campaigns.length,
        settings: settings.length,
      })
    );
  });
  app.addHook('onClose', async () => {
    if (envFlag('BISPCRM_AUTO_SYNC_ON_CLOSE', false)) {
      await Promise.all(state.customers.list().map((c) => state.postgresMirror.saveCustomer(c)));
      await Promise.all(state.assistance.list().map((t) => state.postgresMirror.saveTicket(t)));
      await Promise.all(state.offers.listAll().map((o) => state.postgresMirror.saveOffer(o)));
      await Promise.all(state.objectives.listAll().map((o) => state.postgresMirror.saveObjective(o)));
      await Promise.all(state.tasks.list().map((t) => state.postgresMirror.saveTasks([t])));
      await Promise.all(state.drafts.list().map((o) => state.postgresMirror.saveOutbox([o])));
      await Promise.all(state.campaigns.list().map((c) => state.postgresMirror.saveCampaign(c)));
      await Promise.all(state.adminSettings.list({ masked: false }).map((s) => state.postgresMirror.saveAdminSetting(s)));
    }
    await state.queueGateway.close().catch(() => undefined);
    await state.postgresMirror.close().catch(() => undefined);
  });

  app.get('/health', async () => ({ ok: true, service: 'api-core', ts: new Date().toISOString() }));

  app.get('/api/customers', async () => state.customers.list());
  app.get('/api/datahub/overview', async () => {
    const customers = state.customers.list();
    const offers = state.offers.listAll();
    const tickets = state.assistance.list();
    const objectives = state.objectives.listAll();
    const outbox = state.drafts.list();
    const segments = customers.reduce<Record<string, number>>((acc, c) => {
      c.segments.forEach((s) => { acc[s] = (acc[s] ?? 0) + 1; });
      return acc;
    }, {});
    return {
      customers: customers.length,
      offers: { total: offers.length, active: offers.filter((o) => o.active).length },
      tickets: { total: tickets.length, open: tickets.filter((t) => t.outcome === 'pending').length },
      objectives: { total: objectives.length, active: objectives.filter((o) => o.active).length },
      outbox: { total: outbox.length, pendingApproval: outbox.filter((o) => o.status === 'pending-approval').length },
      segments,
    };
  });
  app.get<{ Params: { customerId: string } }>('/api/datahub/customers/:customerId', async (req, reply) => {
    const customer = state.customers.getById(req.params.customerId);
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });
    const tickets = state.assistance.list().filter((t) => t.customerId === customer.id || t.phoneLookup === customer.phone);
    const tasks = state.tasks.list().filter((t) => t.customerId === customer.id);
    const outbox = state.drafts.list().filter((o) => o.draft.customerId === customer.id);
    const ragHints = state.rag.search(`${customer.fullName} ${customer.interests.join(' ')} ${customer.segments.join(' ')}`, 6);
    return { customer, tickets, tasks, outbox, ragHints };
  });
  app.get<{ Querystring: { q: string } }>('/api/datahub/search', async (req, reply) => {
    const q = req.query.q?.trim().toLowerCase();
    if (!q) return reply.code(400).send({ error: 'q is required' });
    const customers = state.customers.list().filter((c) =>
      c.fullName.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.segments.some((s) => s.toLowerCase().includes(q))
    );
    const offers = state.offers.listAll().filter((o) =>
      o.title.toLowerCase().includes(q) || o.category.toLowerCase().includes(q)
    );
    return { q, customers, offers };
  });
  app.get('/api/assist/tickets', async () => state.assistance.list());
  app.get<{ Querystring: { category?: ProductOffer['category']; q?: string } }>('/api/offers', async (req) => {
    let offers = state.offers.listActive();
    if (req.query.category) offers = offers.filter((o) => o.category === req.query.category);
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      offers = offers.filter((o) => o.title.toLowerCase().includes(q));
    }
    return offers;
  });
  app.get('/api/objectives', async () => state.objectives.listActive());
  app.get<{ Querystring: { type?: string; actor?: string } }>('/api/audit', async (req) => {
    let records = state.audit.list();
    if (req.query.type) records = records.filter((r) => r.type === req.query.type);
    if (req.query.actor) records = records.filter((r) => r.actor === req.query.actor);
    return records;
  });
  app.get<{ Querystring: { status?: TaskItem['status']; kind?: TaskItem['kind'] } }>('/api/tasks', async (req, reply) => {
    if (ensurePermission(req, reply, 'tasks:read') === null) return;
    return state.tasks.list({ status: req.query.status, kind: req.query.kind });
  });
  app.patch<{ Params: { taskId: string }; Body: Partial<Pick<TaskItem, 'status' | 'assigneeRole' | 'priority'>> }>(
    '/api/tasks/:taskId',
    async (req, reply) => {
      if (ensurePermission(req, reply, 'tasks:update') === null) return;
      const task = state.tasks.update(req.params.taskId, req.body);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      state.audit.write(makeAuditRecord('task-center', 'task.updated', { taskId: task.id, patch: req.body }));
      void state.postgresMirror.saveTasks([task]);
      return task;
    }
  );
  app.get<{
    Querystring: { status?: 'pending-approval' | 'approved' | 'queued' | 'sent' | 'rejected'; channel?: CommunicationDraft['channel'] };
  }>('/api/outbox', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:read') === null) return;
    return state.drafts.list({ status: req.query.status, channel: req.query.channel });
  });

  app.post<{ Params: { outboxId: string }; Body: { actor?: string } }>('/api/outbox/:outboxId/approve', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    const approved = state.drafts.update(item.id, {
      status: 'approved',
      approvedBy: req.body.actor ?? 'manager',
      approvedAt: new Date().toISOString(),
    });
    state.audit.write(makeAuditRecord('manager', 'outbox.approved', { outboxId: item.id, actor: req.body.actor ?? 'manager' }));
    if (approved) void state.postgresMirror.saveOutbox([approved]);
    return approved;
  });

  app.post<{ Params: { outboxId: string }; Body: { actor?: string; reason?: string } }>('/api/outbox/:outboxId/reject', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    const rejected = state.drafts.update(item.id, {
      status: 'rejected',
      rejectedBy: req.body.actor ?? 'manager',
      rejectedAt: new Date().toISOString(),
    });
    state.audit.write(makeAuditRecord('manager', 'outbox.rejected', { outboxId: item.id, actor: req.body.actor ?? 'manager', reason: req.body.reason ?? null }));
    if (rejected) void state.postgresMirror.saveOutbox([rejected]);
    return rejected;
  });

  app.post<{ Params: { outboxId: string } }>('/api/outbox/:outboxId/send', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    if (item.status === 'pending-approval') return reply.code(409).send({ error: 'Approval required' });

    const queueSend = /^(1|true|yes|on)$/i.test(String(process.env.BISPCRM_QUEUE_SEND_OUTBOX ?? 'false'));
    if (queueSend) {
      const queued = await state.queueGateway.enqueueSocial(item.draft);
      const queuedExternalId = queued.jobId ? `bullmq:${queued.queue}:${queued.jobId}` : undefined;
      const updatedQueued = state.drafts.update(item.id, { status: 'queued', externalId: queuedExternalId, sentAt: new Date().toISOString() });
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.queued', { outboxId: item.id, mode: queued.mode, queue: queued.queue ?? null, jobId: queued.jobId ?? null }));
      if (updatedQueued) void state.postgresMirror.saveOutbox([updatedQueued]);
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: 'queued',
          requestPayload: { draft: item.draft },
          responsePayload: { mode: queued.mode, queue: queued.queue ?? null, jobId: queued.jobId ?? null },
        })
      );
      return updatedQueued;
    }

    try {
      let externalId = '';
      let providerResult: Record<string, unknown> = {};
      if (item.draft.channel === 'telegram') {
        const res = await state.channels.telegram.queueOfferMessage(item.draft);
        externalId = `telegram_${String(res.queued)}`;
        providerResult = { queued: res.queued };
      } else if (item.draft.channel === 'email') {
        const res = await state.channels.email.sendOrQueue(item.draft);
        externalId = `email_${res.status}`;
        providerResult = { status: res.status };
      } else if (item.draft.channel === 'whatsapp') {
        const res = await state.channels.whatsapp.sendOrQueue(item.draft);
        externalId = res.messageId ?? `wa_${item.draft.id}`;
        providerResult = { status: res.status, messageId: res.messageId };
      } else if (['facebook', 'instagram', 'x'].includes(item.draft.channel)) {
        const res = await state.channels.social.publish(item.draft);
        externalId = `social_${res.platform}`;
        providerResult = { queued: res.queued, platform: res.platform };
      } else {
        const res = await state.channels.elizaPublishing.publish(item.draft);
        externalId = res.externalId;
        providerResult = { externalId: res.externalId, status: res.status };
      }

      const status = item.draft.needsApproval ? 'queued' : 'sent';
      const updated = state.drafts.update(item.id, { status, externalId, sentAt: new Date().toISOString() });
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.sent', { outboxId: item.id, channel: item.draft.channel, status, externalId }));
      if (updated) void state.postgresMirror.saveOutbox([updated]);
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status,
          requestPayload: { draft: item.draft },
          responsePayload: { externalId, ...providerResult },
        })
      );
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.send.failed', { outboxId: item.id, channel: item.draft.channel, error: message }));
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: 'failed',
          requestPayload: { draft: item.draft },
          responsePayload: {},
          error: message,
        })
      );
      return reply.code(502).send({ error: 'Channel send failed', detail: message });
    }
  });
  app.post<{ Params: { outboxId: string }; Body: { actor?: string } }>('/api/outbox/:outboxId/approve-send', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:approve') === null) return;
    const item = state.drafts.getById(req.params.outboxId);
    if (!item) return reply.code(404).send({ error: 'Outbox item not found' });
    if (item.status === 'pending-approval') {
      state.drafts.update(item.id, {
        status: 'approved',
        approvedBy: req.body.actor ?? 'manager',
        approvedAt: new Date().toISOString(),
      });
      state.audit.write(makeAuditRecord('manager', 'outbox.approved', { outboxId: item.id, actor: req.body.actor ?? 'manager' }));
    }
    try {
      let externalId = '';
      let providerResult: Record<string, unknown> = {};
      if (item.draft.channel === 'telegram') {
        const res = await state.channels.telegram.queueOfferMessage(item.draft);
        externalId = `telegram_${String(res.queued)}`;
        providerResult = { queued: res.queued };
      } else if (item.draft.channel === 'email') {
        const res = await state.channels.email.sendOrQueue(item.draft);
        externalId = `email_${res.status}`;
        providerResult = { status: res.status };
      } else if (item.draft.channel === 'whatsapp') {
        const res = await state.channels.whatsapp.sendOrQueue(item.draft);
        externalId = res.messageId ?? `wa_${item.draft.id}`;
        providerResult = { status: res.status, messageId: res.messageId };
      } else if (['facebook', 'instagram', 'x'].includes(item.draft.channel)) {
        const res = await state.channels.social.publish(item.draft);
        externalId = `social_${res.platform}`;
        providerResult = { queued: res.queued, platform: res.platform };
      } else {
        const res = await state.channels.elizaPublishing.publish(item.draft);
        externalId = res.externalId;
        providerResult = { externalId: res.externalId, status: res.status };
      }
      // Derive real dispatch status from provider response
      let dispatchStatus: 'queued' | 'sent' = 'queued';
      if (item.draft.channel === 'telegram') {
        dispatchStatus = (providerResult as { sent?: boolean }).sent ? 'sent' : 'queued';
      } else if (item.draft.channel === 'email' || item.draft.channel === 'whatsapp') {
        dispatchStatus = (providerResult as { status?: string }).status === 'sent' ? 'sent' : 'queued';
      }

      const updated = state.drafts.update(item.id, { status: dispatchStatus, externalId, sentAt: new Date().toISOString() });
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.sent', { outboxId: item.id, channel: item.draft.channel, status: dispatchStatus, externalId }));
      if (updated) void state.postgresMirror.saveOutbox([updated]);
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: dispatchStatus,
          requestPayload: { draft: item.draft },
          responsePayload: { externalId, ...providerResult },
        })
      );

      // Saturation bump: each sent message += 2 points
      if (item.draft.customerId) {
        const sentCustomer = state.customers.getById(item.draft.customerId);
        if (sentCustomer) {
          sentCustomer.commercialSaturationScore = Math.min(100, sentCustomer.commercialSaturationScore + 2);
          state.customers.upsert(sentCustomer);
          void state.postgresMirror.saveCustomer(sentCustomer);
        }
      }

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.audit.write(makeAuditRecord('channel-gateway', 'outbox.send.failed', { outboxId: item.id, channel: item.draft.channel, error: message }));
      void state.postgresMirror.saveChannelDispatch(
        buildChannelDispatchRecord({
          draftId: item.id,
          channel: item.draft.channel,
          status: 'failed',
          requestPayload: { draft: item.draft },
          responsePayload: {},
          error: message,
        })
      );
      return reply.code(502).send({ error: 'Channel send failed', detail: message });
    }
  });

  app.get('/api/campaigns', async () => state.campaigns.list());
  app.get('/api/swarm/capabilities', async () => ({
    agents: [
      { id: 'assistance', enabled: true },
      { id: 'preventivi', enabled: true },
      { id: 'telephony', enabled: true },
      { id: 'energy', enabled: true },
      { id: 'hardware', enabled: true },
      { id: 'customer-care', enabled: true },
      { id: 'content', enabled: true },
      { id: 'compliance', enabled: true },
    ],
    characters: state.characterStudio.list().map((c) => ({ key: c.key, enabled: c.enabled, modelTier: c.modelTier, channels: c.channels })),
    queueMode: state.queueGateway.getMode(),
    orchestrator: 'rule-scoring-handoff',
  }));
  app.post<{
    Body: { eventType: DomainEvent['type']; customerId?: string; payload?: Record<string, unknown> };
  }>('/api/swarm/simulate', async (req, reply) => {
    const event: DomainEvent = {
      id: makeId('evt'),
      type: req.body.eventType,
      occurredAt: new Date().toISOString(),
      customerId: req.body.customerId,
      payload: req.body.payload ?? {},
    };
    const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
    const output = state.orchestrator.run({
      event,
      customer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    });
    persistOperationalOutput(state, output);
    return reply.code(201).send({ event, output });
  });
  app.get('/api/system/db/snapshot', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const counts = await state.postgresMirror.snapshotCounts();
    return { counts };
  });
  app.post('/api/system/db/sync-runtime', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const customers = state.customers.list();
    const tickets = state.assistance.list();
    const offers = state.offers.listAll();
    const objectives = state.objectives.listAll();
    const tasks = state.tasks.list();
    const outbox = state.drafts.list();
    const campaigns = state.campaigns.list();
    const settings = state.adminSettings.list({ masked: false });
    await Promise.all(customers.map((c) => state.postgresMirror.saveCustomer(c)));
    await Promise.all(tickets.map((t) => state.postgresMirror.saveTicket(t)));
    await Promise.all(offers.map((o) => state.postgresMirror.saveOffer(o)));
    await Promise.all(objectives.map((o) => state.postgresMirror.saveObjective(o)));
    await Promise.all(tasks.map((t) => state.postgresMirror.saveTasks([t])));
    await Promise.all(outbox.map((o) => state.postgresMirror.saveOutbox([o])));
    await Promise.all(campaigns.map((c) => state.postgresMirror.saveCampaign(c)));
    await Promise.all(settings.map((s) => state.postgresMirror.saveAdminSetting(s)));
    const counts = await state.postgresMirror.snapshotCounts();
    state.audit.write(makeAuditRecord('system', 'db.sync_runtime', { counts }));
    return { ok: true, counts };
  });
  app.post('/api/system/db/load-runtime', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const [customers, tickets, offers, objectives, tasks, outbox, campaigns, settings] = await Promise.all([
      state.postgresMirror.loadCustomers(),
      state.postgresMirror.loadTickets(),
      state.postgresMirror.loadOffers(),
      state.postgresMirror.loadObjectives(),
      state.postgresMirror.loadTasks(),
      state.postgresMirror.loadOutbox(),
      state.postgresMirror.loadCampaigns(),
      state.postgresMirror.loadAdminSettings(),
    ]);
    if (customers.length) state.customers.replaceAll(customers);
    if (tickets.length) state.assistance.replaceAll(tickets);
    if (offers.length) state.offers.replaceAll(offers);
    if (objectives.length) state.objectives.replaceAll(objectives);
    if (tasks.length) state.tasks.replaceAll(tasks);
    if (outbox.length) state.drafts.replaceAll(outbox);
    if (campaigns.length) state.campaigns.replaceAll(campaigns);
    if (settings.length) state.adminSettings.replaceAll(settings);
    state.rag = buildRagStore(state.customers.list(), state.offers.listActive());
    state.audit.write(makeAuditRecord('system', 'db.load_runtime', {
      customers: customers.length,
      tickets: tickets.length,
      offers: offers.length,
      objectives: objectives.length,
      tasks: tasks.length,
      outbox: outbox.length,
      campaigns: campaigns.length,
      settings: settings.length,
    }));
    return {
      ok: true,
      loaded: {
        customers: customers.length,
        tickets: tickets.length,
        offers: offers.length,
        objectives: objectives.length,
        tasks: tasks.length,
        outbox: outbox.length,
        campaigns: campaigns.length,
        settings: settings.length,
      },
    };
  });
  app.post<{ Body: { queue?: 'orchestrator-events' | 'content-jobs' | 'social-publish' | 'media-jobs'; payload?: unknown } }>('/api/system/queue/enqueue-test', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const queueName = req.body.queue ?? 'orchestrator-events';
    if (queueName === 'orchestrator-events') return state.queueGateway.enqueueOrchestrator(req.body.payload ?? { ping: true, ts: new Date().toISOString() });
    if (queueName === 'content-jobs') return state.queueGateway.enqueueContent(req.body.payload ?? { prompt: 'test content prompt' });
    if (queueName === 'media-jobs') return state.queueGateway.enqueueMedia(req.body.payload ?? { kind: 'text', title: 'queue test', brief: 'queue media job test' });
    return state.queueGateway.enqueueSocial((req.body.payload as CommunicationDraft) ?? {
      id: `draft_test_${Date.now()}`,
      channel: 'telegram',
      audience: 'one-to-many',
      body: 'Test social queue',
      needsApproval: false,
      reason: 'system queue test',
    });
  });
  app.get('/api/system/infra', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const pg = new PgRuntime({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm' });
    const db = await pg.health().catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    await pg.close().catch(() => undefined);
    const redisConfigured = Boolean(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const mirror = await state.postgresMirror.health();
    const queue = await state.queueGateway.snapshot();
    return {
      postgres: db,
      postgresMirror: mirror,
      redis: { configured: redisConfigured, url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
      queue,
      queues: ['orchestrator-events', 'content-jobs', 'social-publish', 'media-jobs'],
      persistenceMode: process.env.BISPCRM_PERSISTENCE_MODE ?? 'memory',
    };
  });
  app.post('/api/system/db/migrate', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const pg = new PgRuntime({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/copilotrm' });
    try {
      const result = await pg.runMigrations();
      state.audit.write(makeAuditRecord('system', 'db.migrations.run', result));
      return { ok: true, ...result };
    } finally {
      await pg.close().catch(() => undefined);
    }
  });
  app.get<{ Querystring: { category?: 'models' | 'channels' | 'autoposting' | 'agents' | 'system'; includeSecrets?: 'true' | 'false' } }>(
    '/api/admin/settings',
    async (req, reply) => {
      if (ensurePermission(req, reply, 'settings:write') === null) return;
      const masked = req.query.includeSecrets === 'true' ? false : true;
      return {
        updatedAt: state.adminSettings.snapshot({ masked }).updatedAt,
        items: state.adminSettings.list({ masked, category: req.query.category }),
      };
    }
  );
  app.get<{ Params: { key: string } }>('/api/admin/settings/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const item = state.adminSettings.get(req.params.key);
    if (!item) return reply.code(404).send({ error: 'Setting not found' });
    return item;
  });
  app.patch<{ Params: { key: string }; Body: { value: unknown; persist?: boolean } }>('/api/admin/settings/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const current = state.adminSettings.get(req.params.key, { masked: false });
    if (!current) return reply.code(404).send({ error: 'Setting not found' });
    const next = state.adminSettings.upsert(req.params.key, req.body.value as never);
    if (req.body.persist) state.adminSettings.persist();
    state.audit.write(makeAuditRecord('admin-settings', 'setting.updated', { key: req.params.key, persist: Boolean(req.body.persist) }));
    void state.postgresMirror.saveAdminSetting(next);
    return { ...next, value: current.type === 'secret' ? 'updated' : next.value };
  });
  app.get('/api/admin/characters', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return state.characterStudio.list();
  });
  app.get<{ Params: { key: string } }>('/api/admin/characters/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const character = state.characterStudio.get(req.params.key);
    if (!character) return reply.code(404).send({ error: 'Character not found' });
    return character;
  });
  app.patch<{
    Params: { key: string };
    Body: {
      name?: string;
      role?: string;
      tone?: string[];
      goals?: string[];
      limits?: string[];
      channels?: string[];
      style?: string[];
      enabled?: boolean;
      modelTier?: 'small' | 'medium' | 'large';
      systemInstructions?: string;
      apiSources?: string[];
      persist?: boolean;
    };
  }>('/api/admin/characters/:key', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const next = state.characterStudio.upsert(req.params.key, req.body);
    if (req.body.persist) state.characterStudio.persist();
    state.audit.write(makeAuditRecord('character-studio', 'character.updated', { key: req.params.key, persist: Boolean(req.body.persist) }));
    return next;
  });
  app.get<{ Params: { key: string } }>('/api/admin/characters/:key/eliza-preview', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const preview = state.characterStudio.toElizaLike(req.params.key);
    if (!preview) return reply.code(404).send({ error: 'Character not found' });
    return preview;
  });
  app.get('/api/admin/agents', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    const items = state.adminSettings.list({ category: 'agents' });
    return items.map((i) => ({ key: i.key, enabled: Boolean(i.value), source: i.source, description: i.description }));
  });
  app.get('/api/admin/models', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return state.adminSettings.list({ category: 'models' });
  });
  app.get('/api/admin/model-catalog', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return ({
    local: [
      { provider: 'ollama', models: ['gemma3:27b', 'deepseek-r1:32b', 'mxbai-embed-large'], kind: ['chat', 'reasoning', 'embedding'] },
      { provider: 'lmstudio', models: ['custom-local'], kind: ['chat'] },
    ],
    cloud: [
      { provider: 'openai', models: ['gpt-4.1-mini', 'gpt-4.1', 'text-embedding-3-small'], kind: ['chat', 'embedding'] },
      { provider: 'deepseek', models: ['deepseek-chat'], kind: ['chat'] },
      { provider: 'google', models: ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'], kind: ['chat', 'embedding'] },
    ],
    strategy: 'local-first with fallback API providers',
  });
  });
  app.get('/api/admin/channels', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return [
      ...state.adminSettings.list({ category: 'channels' }),
      ...state.adminSettings.list({ category: 'autoposting' }),
    ];
  });
  app.get('/api/admin/rbac', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return ({
    authEnabled,
    mode: authEnabled ? 'header-role' : 'preview-rbac-matrix',
    roles: ROLE_PERMISSIONS,
  });
  });
  app.get('/api/admin/integrations', async (req, reply) => {
    if (ensurePermission(req, reply, 'settings:write') === null) return;
    return {
      adapters: {
        danea: { mode: 'read-only-stub', enabled: true },
        eliza: { mode: 'adapter', enabled: true },
        telegram: { mode: 'real', enabled: !!process.env.TELEGRAM_BOT_TOKEN },
        email: { mode: 'real', enabled: !!process.env.SENDGRID_API_KEY },
        whatsapp: { mode: 'real', enabled: !!process.env.WHATSAPP_API_TOKEN },
        social: { mode: 'stub', enabled: false },
        media: { mode: 'service-layer-stub', enabled: true },
      },
      queue: await state.queueGateway.snapshot(),
      persistence: await state.postgresMirror.health(),
    };
  });
  app.get('/api/channels/dispatches', async (req, reply) => {
    if (ensurePermission(req, reply, 'outbox:read') === null) return;
    return state.postgresMirror.loadChannelDispatches(200);
  });
  app.get('/api/media/jobs', async (req, reply) => {
    if (ensurePermission(req, reply, 'tasks:read') === null) return;
    return state.postgresMirror.loadMediaJobs(200);
  });
  app.post<{
    Body: {
      kind: 'text' | 'voice-script' | 'avatar-video' | 'podcast';
      title: string;
      brief: string;
      channel?: 'blog' | 'facebook' | 'instagram' | 'x' | 'telegram' | 'whatsapp';
    };
  }>('/api/media/generate', async (req, reply) => {
    if (ensurePermission(req, reply, 'tasks:update') === null) return;
    if (!req.body.title || !req.body.brief) return reply.code(400).send({ error: 'title and brief are required' });
    const mediaJob: MediaJobRecord = {
      id: makeId('media'),
      kind: req.body.kind,
      title: req.body.title,
      brief: req.body.brief,
      channel: req.body.channel,
      status: 'processing',
      requestPayload: req.body as unknown as Record<string, unknown>,
      createdBy: String(req.headers['x-bisp-role'] ?? 'system'),
      createdAt: new Date().toISOString(),
    };
    void state.postgresMirror.saveMediaJob(mediaJob);
    const queueMedia = envFlag('BISPCRM_QUEUE_MEDIA_JOBS', false);
    if (queueMedia) {
      const queued = await state.queueGateway.enqueueMedia(mediaJob);
      const queuedJob: MediaJobRecord = {
        ...mediaJob,
        status: 'queued',
        resultPayload: {
          mode: queued.mode,
          queue: queued.queue ?? null,
          jobId: queued.jobId ?? null,
        },
      };
      void state.postgresMirror.saveMediaJob(queuedJob);
      state.audit.write(makeAuditRecord('media-service', 'media.job.queued', { id: mediaJob.id, kind: mediaJob.kind, queue: queued.queue ?? null, jobId: queued.jobId ?? null }));
      return reply.code(202).send({ job: queuedJob });
    }
    try {
      const result = await state.media.generate(req.body);
      const completed: MediaJobRecord = {
        ...mediaJob,
        status: 'completed',
        resultPayload: result as unknown as Record<string, unknown>,
        processedAt: new Date().toISOString(),
      };
      void state.postgresMirror.saveMediaJob(completed);
      state.audit.write(makeAuditRecord('media-service', 'media.generated', { id: mediaJob.id, kind: req.body.kind, title: req.body.title, channel: req.body.channel ?? null }));
      return reply.code(201).send({ job: completed, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: MediaJobRecord = {
        ...mediaJob,
        status: 'failed',
        error: message,
        processedAt: new Date().toISOString(),
      };
      void state.postgresMirror.saveMediaJob(failed);
      state.audit.write(makeAuditRecord('media-service', 'media.failed', { id: mediaJob.id, error: message }));
      return reply.code(500).send({ error: 'Media generation failed', detail: message, job: failed });
    }
  });

  app.get<{ Querystring: { phone?: string } }>('/api/assist/customers/lookup', async (req, reply) => {
    const phone = req.query.phone?.trim();
    if (!phone) return reply.code(400).send({ error: 'phone query param required' });
    const customer = state.customers.findByPhone(phone);
    state.audit.write(
      makeAuditRecord('assist-desk', 'assist.lookup.phone', {
        phone,
        found: Boolean(customer),
        customerId: customer?.id,
      })
    );
    return {
      found: Boolean(customer),
      customer: customer ?? null,
      mode: customer ? 'existing-customer' : 'provisional-customer-required',
      rule: 'No master customer creation from assist desk',
    };
  });

  app.post<{
    Body: {
      phone: string;
      deviceType: string;
      issue: string;
      customerId?: string;
      inferredSignals?: string[];
      // Extended NLP fields
      customerName?: string;
      customerEmail?: string;
      brand?: string;
      model?: string;
      serialNumber?: string;
      hasWarranty?: boolean;
      estimatedPrice?: number;
      ticketNotes?: string;
    };
  }>('/api/assist/tickets', async (req, reply) => {
    const {
      phone, deviceType, issue, customerId, inferredSignals = [],
      customerName, customerEmail, brand, model, serialNumber,
      hasWarranty, estimatedPrice, ticketNotes,
    } = req.body;
    if (!phone || !deviceType || !issue) {
      return reply.code(400).send({ error: 'phone, deviceType, issue are required' });
    }

    const matchedCustomer = customerId
      ? state.customers.getById(customerId)
      : state.customers.findByPhone(phone);

    const now = new Date().toISOString();
    const ticket: AssistanceTicket = {
      id: makeId('ticket'),
      customerId: matchedCustomer?.id,
      provisionalCustomer: !matchedCustomer,
      phoneLookup: phone,
      deviceType,
      issue,
      outcome: 'pending',
      inferredSignals,
      createdAt: now,
      updatedAt: now,
      customerName,
      customerEmail,
      brand,
      model,
      serialNumber,
      hasWarranty,
      estimatedPrice,
      ticketNotes,
    };

    state.assistance.upsert(ticket);
    void state.postgresMirror.saveTicket(ticket);
    state.audit.write(
      makeAuditRecord('assist-desk', 'assist.ticket.created', {
        ticketId: ticket.id,
        customerId: ticket.customerId ?? null,
        provisionalCustomer: ticket.provisionalCustomer,
        phoneLookup: ticket.phoneLookup,
        rule: ticket.provisionalCustomer
          ? 'Created provisional internal ticket only (no master customer)'
          : 'Linked to existing customer',
      })
    );

    return reply.code(201).send({
      ticket,
      customer: matchedCustomer ?? null,
      provisionalCustomerNotice: ticket.provisionalCustomer
        ? 'Cliente non trovato: creato ticket con cliente provvisorio interno. Nessuna anagrafica master creata.'
        : null,
    });
  });

  app.post<{
    Body: {
      channel: 'email' | 'whatsapp';
      from: string;
      subject?: string;
      body: string;
      customerId?: string;
      phone?: string;
      email?: string;
    };
  }>('/api/inbound/message', async (req, reply) => {
    const permission = req.body.channel === 'email' ? 'inbound:read' : 'inbound:read';
    if (ensurePermission(req, reply, permission) === null) return;
    if (!req.body.from || !req.body.body) {
      return reply.code(400).send({ error: 'from and body are required' });
    }
    const inferredCustomer =
      req.body.customerId
        ? state.customers.getById(req.body.customerId)
        : req.body.phone
          ? state.customers.findByPhone(req.body.phone)
          : undefined;
    const event: DomainEvent = {
      id: makeId('evt'),
      type: req.body.channel === 'email' ? 'inbound.email.received' : 'inbound.whatsapp.received',
      occurredAt: new Date().toISOString(),
      customerId: inferredCustomer?.id,
      payload: {
        from: req.body.from,
        subject: req.body.subject ?? null,
        body: req.body.body,
        phone: req.body.phone ?? null,
        email: req.body.email ?? null,
      },
    };
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    state.audit.write(
      makeAuditRecord('inbound-gateway', 'inbound.received', {
        eventType: event.type,
        customerId: event.customerId ?? null,
        from: req.body.from,
      })
    );
    const output = state.orchestrator.run({
      event,
      customer: inferredCustomer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    });
    persistOperationalOutput(state, output);
    return reply.code(201).send({ event, customer: inferredCustomer ?? null, orchestrator: output });
  });

  app.post<{
    Body: {
      customerId?: string;
      phone?: string;
      disposition: 'answered' | 'missed' | 'callback-request' | 'complaint';
      notes: string;
    };
  }>('/api/inbound/calls/log', async (req, reply) => {
    if (ensurePermission(req, reply, 'inbound:read') === null) return;
    if (!req.body.notes || !req.body.disposition) return reply.code(400).send({ error: 'disposition and notes are required' });
    const inferredCustomer =
      req.body.customerId
        ? state.customers.getById(req.body.customerId)
        : req.body.phone
          ? state.customers.findByPhone(req.body.phone)
          : undefined;
    const event: DomainEvent = {
      id: makeId('evt'),
      type: 'inbound.whatsapp.received',
      occurredAt: new Date().toISOString(),
      customerId: inferredCustomer?.id,
      payload: {
        channel: 'call',
        disposition: req.body.disposition,
        notes: req.body.notes,
        phone: req.body.phone ?? null,
      },
    };
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    state.audit.write(makeAuditRecord('inbound-gateway', 'call.logged', { customerId: inferredCustomer?.id ?? null, disposition: req.body.disposition }));
    const output = state.orchestrator.run({
      event,
      customer: inferredCustomer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    });
    persistOperationalOutput(state, output);
    return reply.code(201).send({ event, customer: inferredCustomer ?? null, orchestrator: output });
  });

  app.post<{ Body: { event: DomainEvent } }>('/api/orchestrate', async (req) => {
    const event = req.body.event;
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
    const ctx = {
      event,
      customer,
      activeObjectives: state.objectives.listActive(),
      activeOffers: state.offers.listActive(),
      now: new Date().toISOString(),
    };
    const { output, runId } = await state.orchestrator.runSwarm(ctx, state.swarmRuntime);
    persistOperationalOutput(state, output);
    void broadcastSwarmDebug(state, runId, event.type, output.tasks.length, output.drafts.length);
    return { ...output, swarmRunId: runId };
  });

  app.get('/api/manager/objectives', async () => state.objectives.listAll());
  app.post<{ Body: ManagerObjective }>('/api/manager/objectives', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    state.objectives.upsert(req.body);
    state.audit.write(makeAuditRecord('manager', 'objective.upserted', { objectiveId: req.body.id, name: req.body.name }));
    void state.postgresMirror.saveObjective(req.body);
    return reply.code(201).send(req.body);
  });
  app.patch<{ Params: { objectiveId: string }; Body: Partial<ManagerObjective> }>('/api/manager/objectives/:objectiveId', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    const current = state.objectives.getById(req.params.objectiveId);
    if (!current) return reply.code(404).send({ error: 'Objective not found' });
    const merged = { ...current, ...req.body };
    state.objectives.upsert(merged);
    state.audit.write(makeAuditRecord('manager', 'objective.updated', { objectiveId: merged.id, patch: req.body }));
    void state.postgresMirror.saveObjective(merged);
    // Propaga come DomainEvent → orchestrator notifica content + preventivi
    const objEvent: DomainEvent = {
      id: makeId('evt'),
      type: 'manager.objective.updated',
      occurredAt: new Date().toISOString(),
      payload: { objectiveId: merged.id, name: merged.name, active: merged.active },
    };
    const objCtx = { event: objEvent, activeObjectives: state.objectives.listActive(), activeOffers: state.offers.listActive(), now: new Date().toISOString() };
    void state.orchestrator.runSwarm(objCtx, state.swarmRuntime).then(({ output, runId }) => {
      persistOperationalOutput(state, output);
      void broadcastSwarmDebug(state, runId, objEvent.type, output.tasks.length, output.drafts.length);
    }).catch(() => undefined);
    return merged;
  });
  app.post<{ Params: { objectiveId: string }; Body: { active: boolean } }>('/api/manager/objectives/:objectiveId/activate', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    const current = state.objectives.getById(req.params.objectiveId);
    if (!current) return reply.code(404).send({ error: 'Objective not found' });
    const merged = { ...current, active: Boolean(req.body.active) };
    state.objectives.upsert(merged);
    state.audit.write(makeAuditRecord('manager', 'objective.activation.updated', { objectiveId: merged.id, active: merged.active }));
    void state.postgresMirror.saveObjective(merged);
    return merged;
  });
  app.delete<{ Params: { objectiveId: string } }>('/api/manager/objectives/:objectiveId', async (req, reply) => {
    if (ensurePermission(req, reply, 'objectives:write') === null) return;
    const current = state.objectives.getById(req.params.objectiveId);
    if (!current) return reply.code(404).send({ error: 'Objective not found' });
    state.objectives.upsert({ ...current, active: false });
    state.audit.write(makeAuditRecord('manager', 'objective.deleted.soft', { objectiveId: current.id }));
    return { ok: true, objectiveId: current.id, mode: 'soft-delete(active=false)' };
  });
  app.get('/api/manager/objectives/scorecard', async () => {
    const objectives = state.objectives.listAll();
    const offers = state.offers.listActive();
    return objectives.map((o) => ({
      id: o.id,
      name: o.name,
      active: o.active,
      preferredOfferIds: o.preferredOfferIds,
      preferredOffersAvailable: o.preferredOfferIds.filter((id) => offers.some((off) => off.id === id)).length,
    }));
  });
  app.get('/api/manager/kpi', async (req, reply) => {
    if (ensurePermission(req, reply, 'kpi:read') === null) return;
    const tasks = state.tasks.list();
    const outbox = state.drafts.list();
    const byChannel = outbox.reduce<Record<string, number>>((acc, item) => {
      acc[item.draft.channel] = (acc[item.draft.channel] ?? 0) + 1;
      return acc;
    }, {});
    const pendingApprovals = outbox.filter((o) => o.status === 'pending-approval').length;
    return {
      objectivesActive: state.objectives.listActive().length,
      offersActive: state.offers.listActive().length,
      ticketsOpen: state.assistance.list().filter((t) => t.outcome === 'pending').length,
      tasks: {
        total: tasks.length,
        open: tasks.filter((t) => t.status === 'open').length,
        done: tasks.filter((t) => t.status === 'done').length,
        byKind: tasks.reduce<Record<string, number>>((acc, t) => ((acc[t.kind] = (acc[t.kind] ?? 0) + 1), acc), {}),
      },
      outbox: {
        total: outbox.length,
        pendingApprovals,
        byStatus: outbox.reduce<Record<string, number>>((acc, o) => ((acc[o.status] = (acc[o.status] ?? 0) + 1), acc), {}),
        byChannel,
      },
      auditRecords: state.audit.list().length,
      swarm: (() => {
        const runs = state.swarmRuntime.listRuns(1000);
        const withScore = runs.filter((r) => r.topActionScore != null);
        return {
          total: runs.length,
          completed: runs.filter((r) => r.status === 'completed').length,
          failed: runs.filter((r) => r.status === 'failed').length,
          avgScore: withScore.length
            ? Number((withScore.reduce((s, r) => s + (r.topActionScore ?? 0), 0) / withScore.length).toFixed(3))
            : null,
        };
      })(),
    };
  });

  app.post('/api/ingest/danea/sync', async () => {
    const invoices = state.danea.listRecentInvoices();
    const results = [];
    for (const invoice of invoices) {
      for (const line of invoice.lines) {
        const title = line.description;
        const offerId = makeId('offer');
        const category: ProductOffer['category'] = /oppo|iphone|samsung|smartphone/i.test(title)
          ? 'smartphone'
          : /fibra|router|mesh/i.test(title)
            ? 'connectivity'
            : 'hardware';
        const offer: ProductOffer = {
          id: offerId,
          sourceType: 'invoice',
          category,
          title,
          cost: line.unitCost,
          suggestedPrice: Math.round(line.unitCost * 1.18),
          marginPct: 18,
          stockQty: line.qty,
          targetSegments: category === 'hardware' ? ['gamer'] : category === 'smartphone' ? ['smartphone-upgrade', 'famiglia'] : ['fibra', 'gamer'],
          active: true,
        };
        state.offers.upsert(offer);
        void state.postgresMirror.saveOffer(offer);
        state.rag.add({ id: `offer:${offer.id}`, text: `${offer.title}. costo ${offer.cost}. prezzo suggerito ${offer.suggestedPrice}.` });
        const event: DomainEvent = {
          id: makeId('evt'),
          type: 'danea.invoice.ingested',
          occurredAt: invoice.receivedAt,
          payload: { invoiceId: invoice.id, lines: invoice.lines },
        };
        if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
          void state.queueGateway.enqueueOrchestrator(event);
        }
        const output = state.orchestrator.run({ event, activeObjectives: state.objectives.listActive(), activeOffers: state.offers.listActive(), now: new Date().toISOString() });
        persistOperationalOutput(state, output);
        state.audit.write(makeAuditRecord('ingest-danea', 'invoice.synced', { invoiceId: invoice.id, offerId, line: title }));
        results.push({ invoiceId: invoice.id, offer });
      }
    }
    return { synced: results.length, results };
  });
  app.get<{ Querystring: { kind?: 'danea' | 'promo' } }>('/api/ingest/history', async (req) => {
    const type = req.query.kind === 'promo'
      ? 'promo.ingested'
      : req.query.kind === 'danea'
        ? 'invoice.synced'
        : undefined;
    const records = state.audit.list().filter((r) => {
      if (r.actor !== 'ingest-danea' && r.actor !== 'ingest-promo') return false;
      return type ? r.type.endsWith(type) : true;
    });
    return records.slice(-200).reverse();
  });

  app.post<{ Body: { title: string; category?: ProductOffer['category']; conditions?: string; stockQty?: number; cost?: number; targetSegments?: Segment[] } }>(
    '/api/ingest/promo',
    async (req, reply) => {
      const offer: ProductOffer = {
        id: makeId('offer'),
        sourceType: 'promo',
        category: req.body.category ?? 'smartphone',
        title: req.body.title,
        conditions: req.body.conditions,
        cost: req.body.cost,
        suggestedPrice: req.body.cost ? Math.round(req.body.cost * 1.15) : undefined,
        marginPct: req.body.cost ? 15 : undefined,
        stockQty: req.body.stockQty ?? 10,
        targetSegments: req.body.targetSegments ?? ['smartphone-upgrade'],
        active: true,
      };
      state.offers.upsert(offer);
      void state.postgresMirror.saveOffer(offer);
      state.rag.add({ id: `offer:${offer.id}`, text: `${offer.title}. ${offer.conditions ?? ''}` });
      const event: DomainEvent = {
        id: makeId('evt'),
        type: 'offer.promo.ingested',
        occurredAt: new Date().toISOString(),
        payload: { offerId: offer.id, title: offer.title, conditions: offer.conditions },
      };
      if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
        void state.queueGateway.enqueueOrchestrator(event);
      }
      const output = state.orchestrator.run({ event, activeObjectives: state.objectives.listActive(), activeOffers: state.offers.listActive(), now: new Date().toISOString() });
      persistOperationalOutput(state, output);
      state.audit.write(makeAuditRecord('ingest-promo', 'promo.ingested', { offerId: offer.id, title: offer.title }));
      return reply.code(201).send({ offer, orchestrator: output });
    }
  );

  app.post<{ Body: { offerId?: string; offerTitle?: string; segment?: Segment; includeOneToOne?: boolean; includeOneToMany?: boolean } }>('/api/campaigns/preview', async (req, reply) => {
    const offer = resolveOfferFromRequest(state, req.body);
    if (!offer) return reply.code(404).send({ error: 'Offer not found', hint: 'Passa offerId reale da /api/offers oppure offerTitle' });
    const segment = req.body.segment ?? offer.targetSegments[0];
    if (!segment) return reply.code(400).send({ error: 'No target segment available for offer' });
    const targets = targetCustomersForOffer({
      customers: state.customers.list(),
      offer,
      objectives: state.objectives.listActive(),
      max: 25,
    });
    const llm = state.llm ?? undefined;
    const oneToOne = req.body.includeOneToOne === false ? [] : await buildOneToOneDraftsForOffer({ targets, offer, llm });
    const oneToMany = req.body.includeOneToMany === false ? [] : await buildOneToManyDraftsForOffer({ offer, segment, llm });
    return {
      offer,
      segment,
      targeting: targets.map((t) => ({ customerId: t.customer.id, fullName: t.customer.fullName, score: t.score, reasons: t.reasons })),
      drafts: { oneToOne, oneToMany },
    };
  });

  app.post<{ Body: { offerId?: string; offerTitle?: string; segment?: Segment; name?: string } }>('/api/campaigns/launch', async (req, reply) => {
    if (ensurePermission(req, reply, 'campaigns:manage') === null) return;
    const offer = resolveOfferFromRequest(state, req.body);
    if (!offer) return reply.code(404).send({ error: 'Offer not found', hint: 'Passa offerId reale da /api/offers oppure offerTitle' });
    const segment = req.body.segment ?? offer.targetSegments[0];
    if (!segment) return reply.code(400).send({ error: 'No target segment available for offer' });

    const dailyCap = getDailyContactCap(state);
    const dispatchedToday = countTodayOneToOneDispatched(state);
    const remainingCap = dailyCap != null ? Math.max(0, dailyCap - dispatchedToday) : 25;
    if (dailyCap != null && remainingCap === 0) {
      return reply.code(429).send({ error: 'dailyContactCapacity reached', sentToday: dispatchedToday, dailyCap });
    }

    const targets = targetCustomersForOffer({ customers: state.customers.list(), offer, objectives: state.objectives.listActive(), max: remainingCap });
    const llm = state.llm ?? undefined;
    const drafts = [
      ...await buildOneToOneDraftsForOffer({ targets, offer, llm }),
      ...await buildOneToManyDraftsForOffer({ offer, segment, llm }),
    ];
    const tasks = buildCampaignTasks(offer, segment);
    state.tasks.addMany(tasks);
    const outboxItems = state.drafts.addMany(drafts);
    drafts.forEach((d) => state.draftsRaw.add(d));
    const campaign = {
      id: makeId('camp'),
      name: req.body.name ?? `Campagna ${offer.title} (${segment})`,
      offerId: offer.id,
      segment,
      status: 'draft' as const,
      outboxIds: outboxItems.map((o) => o.id),
      taskIds: tasks.map((t) => t.id),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.add(campaign);
    state.audit.write(makeAuditRecord('campaigns', 'campaign.created', { campaignId: campaign.id, offerId: offer.id, segment, outboxCount: outboxItems.length }));
    void state.postgresMirror.saveTasks(tasks);
    void state.postgresMirror.saveOutbox(outboxItems);
    void state.postgresMirror.saveCampaign(campaign);
    if (envFlag('BISPCRM_QUEUE_CONTENT_TASKS', false)) {
      tasks
        .filter((t) => t.kind === 'content')
        .forEach((t) => void state.queueGateway.enqueueContent({ taskId: t.id, title: t.title, offerId: t.offerId ?? offer.id }));
    }
    return reply.code(201).send({ campaign, outboxItems, tasks, targetingCount: targets.length });
  });
  app.post<{ Body: { q?: string; segment?: Segment } }>('/api/campaigns/launch-latest', async (req, reply) => {
    if (ensurePermission(req, reply, 'campaigns:manage') === null) return;
    let offers = state.offers.listActive();
    if (req.body.q) {
      const q = req.body.q.toLowerCase();
      offers = offers.filter((o) => o.title.toLowerCase().includes(q));
    }
    const offer = offers[offers.length - 1];
    if (!offer) return reply.code(404).send({ error: 'No offers available' });
    const segment = req.body.segment ?? offer.targetSegments[0];
    if (!segment) return reply.code(400).send({ error: 'No target segment available for offer' });
    const dailyCapLatest = getDailyContactCap(state);
    const dispatchedTodayLatest = countTodayOneToOneDispatched(state);
    const remainingCapLatest = dailyCapLatest != null ? Math.max(0, dailyCapLatest - dispatchedTodayLatest) : 25;
    if (dailyCapLatest != null && remainingCapLatest === 0) {
      return reply.code(429).send({ error: 'dailyContactCapacity reached', sentToday: dispatchedTodayLatest, dailyCap: dailyCapLatest });
    }
    const targets = targetCustomersForOffer({ customers: state.customers.list(), offer, objectives: state.objectives.listActive(), max: remainingCapLatest });
    const llmLatest = state.llm ?? undefined;
    const drafts = [...await buildOneToOneDraftsForOffer({ targets, offer, llm: llmLatest }), ...await buildOneToManyDraftsForOffer({ offer, segment, llm: llmLatest })];
    const tasks = buildCampaignTasks(offer, segment);
    state.tasks.addMany(tasks);
    const outboxItems = state.drafts.addMany(drafts);
    drafts.forEach((d) => state.draftsRaw.add(d));
    const campaign = {
      id: makeId('camp'),
      name: `Campagna ${offer.title} (${segment})`,
      offerId: offer.id,
      segment,
      status: 'draft' as const,
      outboxIds: outboxItems.map((o) => o.id),
      taskIds: tasks.map((t) => t.id),
      createdAt: new Date().toISOString(),
    };
    state.campaigns.add(campaign);
    state.audit.write(makeAuditRecord('campaigns', 'campaign.created', { campaignId: campaign.id, offerId: offer.id, segment, outboxCount: outboxItems.length }));
    void state.postgresMirror.saveTasks(tasks);
    void state.postgresMirror.saveOutbox(outboxItems);
    void state.postgresMirror.saveCampaign(campaign);
    if (envFlag('BISPCRM_QUEUE_CONTENT_TASKS', false)) {
      tasks
        .filter((t) => t.kind === 'content')
        .forEach((t) => void state.queueGateway.enqueueContent({ taskId: t.id, title: t.title, offerId: t.offerId ?? offer.id }));
    }
    return reply.code(201).send({ campaign, outboxItems, tasks, targetingCount: targets.length });
  });

  app.post<{ Body: { customerId: string; prompt?: string; offerId?: string } }>('/api/consult/proposal', async (req, reply) => {
    if (ensurePermission(req, reply, 'consult:read') === null) return;
    const customer = state.customers.getById(req.body.customerId);
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });
    const personaHints = Object.fromEntries(
      state.characterStudio
        .list()
        .filter((c) => c.enabled)
        .map((c) => [c.key, state.characterStudio.toElizaLike(c.key)])
        .filter(([, v]) => Boolean(v))
    ) as Record<string, unknown>;
    const result = await consultProposal({
      customer,
      objectives: state.objectives.listActive(),
      offers: state.offers.listActive(),
      prompt: req.body.prompt,
      offerId: req.body.offerId,
      rag: state.rag,
      personaHintsOverride: personaHints,
      llm: state.llm ?? undefined,
    });
    state.audit.write(makeAuditRecord('consult-agent', 'consult.proposal.generated', { customerId: customer.id, offerId: req.body.offerId ?? null }));
    return result;
  });

  app.get('/api/scenarios', async () => ({
    repairNotWorth: 'ticket assistenza -> non conviene riparare -> preventivo notebook',
    gamerLag: 'ticket assistenza gamer -> proposta connectivity gaming',
    hardwareInvoice: 'fattura hardware -> task content',
    smartphonePromo: 'promo smartphone bundle -> campagna telefonia',
    complaintEmail: 'email reclamo post-vendita -> customer care + proposta coerente'
  }));

  app.post<{ Params: { name: string } }>('/api/scenarios/:name/run', async (req, reply) => {
    const event = (scenarioFactory as Record<string, () => DomainEvent>)[req.params.name]?.();
    if (!event) return reply.code(404).send({ error: 'Scenario not found' });
    if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
      void state.queueGateway.enqueueOrchestrator(event);
    }
    const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
    const output = state.orchestrator.run({ event, customer, activeObjectives: state.objectives.listActive(), activeOffers: state.offers.listActive(), now: new Date().toISOString() });
    persistOperationalOutput(state, output);
    return { scenario: req.params.name, event, output };
  });

  app.post<{ Params: { ticketId: string }; Body: { diagnosis?: string; outcome: AssistanceTicket['outcome']; inferredSignals?: string[] } }>(
    '/api/assist/tickets/:ticketId/outcome',
    async (req, reply) => {
      const ticket = state.assistance.getById(req.params.ticketId);
      if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

      ticket.diagnosis = req.body.diagnosis ?? ticket.diagnosis;
      ticket.outcome = req.body.outcome;
      ticket.inferredSignals = req.body.inferredSignals ?? ticket.inferredSignals;
      ticket.updatedAt = new Date().toISOString();
      state.assistance.upsert(ticket);
      void state.postgresMirror.saveTicket(ticket);

      // Customer profile learning
      if (ticket.customerId) {
        const linkedCustomer = state.customers.getById(ticket.customerId);
        if (linkedCustomer) {
          if (!linkedCustomer.assistanceHistory.includes(ticket.id)) {
            linkedCustomer.assistanceHistory.push(ticket.id);
          }
          const note = `[${new Date().toLocaleDateString('it-IT')}] ${ticket.deviceType}: ${ticket.outcome ?? 'pending'}${ticket.diagnosis ? ` — ${ticket.diagnosis}` : ''}${ticket.inferredSignals.length ? ` | signals: ${ticket.inferredSignals.join(', ')}` : ''}`;
          linkedCustomer.conversationNotes.push(note);
          state.customers.upsert(linkedCustomer);
          void state.postgresMirror.saveCustomer(linkedCustomer);
        }
      }

      state.audit.write(
        makeAuditRecord('assist-desk', 'assist.ticket.outcome.updated', {
          ticketId: ticket.id,
          outcome: ticket.outcome,
          inferredSignals: ticket.inferredSignals,
          customerId: ticket.customerId ?? null,
        })
      );

      const event: DomainEvent = {
        id: makeId('evt'),
        type: 'assistance.ticket.outcome',
        occurredAt: new Date().toISOString(),
        customerId: ticket.customerId,
        payload: {
          ticketId: ticket.id,
          outcome: ticket.outcome,
          deviceType: ticket.deviceType,
          inferredSignals: ticket.inferredSignals,
          diagnosis: ticket.diagnosis,
        },
      };
      if (envFlag('BISPCRM_QUEUE_ORCHESTRATOR_EVENTS', false)) {
        void state.queueGateway.enqueueOrchestrator(event);
      }

      const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
      const ctx = {
        event,
        customer,
        activeObjectives: state.objectives.listActive(),
        activeOffers: state.offers.listActive(),
        now: new Date().toISOString(),
      };
      const { output, runId } = await state.orchestrator.runSwarm(ctx, state.swarmRuntime);
      persistOperationalOutput(state, output);
      void broadcastSwarmDebug(state, runId, event.type, output.tasks.length, output.drafts.length);

      return { ticket, orchestrator: output, swarmRunId: runId };
    }
  );

  // ── WordPress publish ─────────────────────────────────────────────────────
  app.post(
    '/api/content/publish/wordpress',
    async (req, reply) => {
      const body = req.body as {
        title?: string;
        content?: string;
        excerpt?: string;
        status?: 'publish' | 'draft' | 'pending';
        categories?: number[];
        tags?: number[];
        slug?: string;
      };

      if (!body?.title || !body?.content) {
        return reply.code(400).send({ error: 'title e content sono obbligatori' });
      }

      const wp = createWordPressClientFromEnv();
      if (!wp) {
        return reply.code(503).send({
          error: 'WordPress non configurato (WORDPRESS_SITE_URL, WORDPRESS_USERNAME, WORDPRESS_APP_PASSWORD mancanti)',
        });
      }

      try {
        const result = await wp.createPost({
          title: body.title,
          content: body.content,
          excerpt: body.excerpt,
          status: body.status ?? 'draft',
          categories: body.categories,
          tags: body.tags,
          slug: body.slug,
        });
        state.audit.write(makeAuditRecord('content', 'wordpress.post.created', { postId: result.id, link: result.link, status: result.status }));
        return { ok: true, post: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.audit.write(makeAuditRecord('content', 'wordpress.post.failed', { error: message }));
        return reply.code(502).send({ error: message });
      }
    }
  );

  // ─── Content Cards: persist + approval ──────────────────────────────────────

  // POST /api/content/cards — worker-content invia la card generata
  app.post<{ Body: ContentCard }>('/api/content/cards', async (req, reply) => {
    const card = req.body;
    if (!card?.id || !card?.source || !card?.title) {
      return reply.code(400).send({ error: 'id, source, title obbligatori' });
    }
    state.contentCards.add({ ...card, approvalStatus: card.approvalStatus ?? 'pending', createdAt: card.createdAt ?? new Date().toISOString() });
    return reply.code(201).send({ ok: true, id: card.id });
  });

  app.get('/api/content/cards', async (req) => {
    const qs = req.query as { status?: string };
    const approvalStatus = (qs.status as ContentCard['approvalStatus']) || undefined;
    return state.contentCards.list(approvalStatus ? { approvalStatus } : undefined);
  });

  app.get<{ Params: { cardId: string } }>('/api/content/cards/:cardId', async (req, reply) => {
    const card = state.contentCards.getById(req.params.cardId);
    if (!card) return reply.code(404).send({ error: 'Card not found' });
    return card;
  });

  app.patch<{ Params: { cardId: string } }>(
    '/api/content/cards/:cardId/approve',
    async (req, reply) => {
      if (ensurePermission(req, reply, 'manager:write') === null) return;
      const role = (req.headers['x-bisp-role'] as string) ?? 'manager';
      const card = state.contentCards.update(req.params.cardId, {
        approvalStatus: 'approved',
        approvedBy: role,
        approvedAt: new Date().toISOString(),
      });
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      state.audit.write(makeAuditRecord('content', 'content_card.approved', { cardId: card.id, title: card.title }));
      return card;
    }
  );

  app.patch<{ Params: { cardId: string } }>(
    '/api/content/cards/:cardId/reject',
    async (req, reply) => {
      if (ensurePermission(req, reply, 'manager:write') === null) return;
      const role = (req.headers['x-bisp-role'] as string) ?? 'manager';
      const card = state.contentCards.update(req.params.cardId, {
        approvalStatus: 'rejected',
        approvedBy: role,
        approvedAt: new Date().toISOString(),
      });
      if (!card) return reply.code(404).send({ error: 'Card not found' });
      state.audit.write(makeAuditRecord('content', 'content_card.rejected', { cardId: card.id, title: card.title }));
      return card;
    }
  );

  // ─── WordPress plugin: self-registration ────────────────────────────────────
  app.post<{ Body: { wpUrl: string; secret: string; siteTitle?: string } }>(
    '/api/integrations/wordpress/register',
    async (req, reply) => {
      const { wpUrl, secret, siteTitle } = req.body ?? {};
      if (!wpUrl || !secret) {
        return reply.code(400).send({ error: 'wpUrl e secret obbligatori' });
      }
      state.adminSettings.upsert('wordpress_site_url', wpUrl);
      state.adminSettings.upsert('wordpress_plugin_secret', secret);
      if (siteTitle) state.adminSettings.upsert('wordpress_site_title', siteTitle);
      await state.adminSettings.persist();
      state.audit.write(makeAuditRecord('integrations', 'wordpress.plugin.registered', { wpUrl, siteTitle: siteTitle ?? '' }));
      return { ok: true, message: 'WordPress plugin registrato correttamente' };
    }
  );

  // GET /api/download/wordpress-plugin — scarica il plugin .zip
  app.get('/api/download/wordpress-plugin', async (req, reply) => {
    const apiUrl = process.env.COPILOTRM_API_URL ?? `http://localhost:${process.env.PORT_API_CORE ?? 4010}`;
    const pluginZip = buildWordPressPluginZip(apiUrl);
    void reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="copilotrm-wp-plugin.zip"')
      .header('Content-Length', String(pluginZip.length));
    return reply.send(pluginZip);
  });

  // ─── CopilotRM Chat endpoint ─────────────────────────────────────────────

  // ─── /api/chat — SSE streaming: ogni agente appare non appena risponde ──────
  app.post<{
    Body: { message: string; customerId?: string; sessionId?: string };
  }>('/api/chat', async (req, reply) => {
    if (ensurePermission(req, reply, 'consult:read') === null) return;
    const { message, customerId, sessionId: incomingSessionId } = req.body;
    if (!message?.trim()) return reply.code(400).send({ error: 'message è obbligatorio' });

    // Switch to raw SSE mode — Fastify non invierà nessuna risposta automatica
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Credentials': 'true',
    });

    const send = (event: ChatSSEEvent): void => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    try {
      // ── Customer resolution ──────────────────────────────────────────────
      let customer = customerId ? state.customers.getById(customerId) : undefined;
      if (!customer && customerId) {
        const needle = customerId.toLowerCase().trim();
        customer = state.customers.list().find((c) =>
          c.fullName.toLowerCase().includes(needle) || c.phone?.includes(needle)
        );
      }
      if (!customer) {
        for (const c of state.customers.list()) {
          if (message.toLowerCase().includes(c.fullName.toLowerCase())) { customer = c; break; }
        }
      }

      // ── Session management ────────────────────────────────────────────────
      const sessionId = incomingSessionId ?? makeId('sess');
      state.conversations.getOrCreate(sessionId, { customerId: customer?.id, customerName: customer?.fullName, firstMessage: message });
      const history = state.conversations.listMessages(sessionId).slice(-6)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      state.conversations.addMessage({ id: makeId('cmsg'), sessionId, role: 'user', content: message, createdAt: new Date().toISOString() });

      const customerData = customer ? { id: customer.id, fullName: customer.fullName, segments: customer.segments } : null;

      // ── Stub quando LLM non configurato ──────────────────────────────────
      if (!state.llm) {
        const stub = customer
          ? `[CopilotRM] Nessun LLM configurato. Cliente: ${customer.fullName}. Imposta LLM_PROVIDER nel .env.`
          : `[CopilotRM] Nessun LLM configurato. Imposta LLM_PROVIDER nel .env.`;
        state.conversations.addMessage({ id: makeId('cmsg'), sessionId, role: 'assistant', content: stub, createdAt: new Date().toISOString() });
        send({ type: 'done', synthesis: stub, swarmRunId: null, sessionId, customer: customerData });
        return reply;
      }

      // ── Carica dati CRM reali ─────────────────────────────────────────────
      const customerTickets = customer ? state.assistance.list().filter((t) => t.customerId === customer!.id) : [];
      const activeOffers = state.offers.listActive();
      const activeObjectives = state.objectives.listActive();

      // ── Orchestrazione con callbacks SSE ─────────────────────────────────
      let swarmThread: ChatSwarmMsg[] = [];
      let synthesis = '';

      const { thread, synthesis: synth } = await runChatOrchestration({
        llm: state.llm,
        message,
        customer,
        customerTickets,
        activeOffers,
        activeObjectives,
        characterStudio: state.characterStudio,
        conversationHistory: history,
        onTyping: (agent, agentRole) => send({ type: 'typing', agent, agentRole }),
        onMessage: (msg) => send({ type: 'message', msg }),
      });
      swarmThread = thread;
      synthesis = synth;

      // ── Registra in SwarmRuntime ──────────────────────────────────────────
      let swarmRunId: string | null = null;
      try {
        const chatEvent: DomainEvent = {
          id: makeId('evt'), type: 'chat.message', occurredAt: new Date().toISOString(),
          payload: { message: message.slice(0, 100), customerId: customer?.id ?? null },
        };
        const chatCtx = { event: chatEvent, customer, activeObjectives, activeOffers, now: new Date().toISOString() };
        const { runId } = await state.orchestrator.runSwarm(chatCtx, state.swarmRuntime);
        swarmRunId = runId;
        const kindMap: Record<ChatSwarmMsg['kind'], 'observation' | 'proposal' | 'handoff' | 'decision' | 'error'> = {
          brief: 'observation', analysis: 'proposal', critique: 'observation', defense: 'proposal', synthesis: 'decision',
        };
        for (const tm of swarmThread) {
          state.swarmRuntime.addMessage({ id: makeId('msg'), runId, stepNo: tm.round * 10, fromAgent: tm.agent, toAgent: tm.mentions[0], kind: kindMap[tm.kind], content: tm.content, createdAt: new Date().toISOString() });
        }
        void broadcastSwarmDebug(state, runId, 'chat.message', 0, 0);
      } catch { /* non-blocking */ }

      // ── Salva conversazione ───────────────────────────────────────────────
      state.conversations.addMessage({ id: makeId('cmsg'), sessionId, role: 'assistant', content: synthesis, swarmThread, swarmRunId: swarmRunId ?? undefined, createdAt: new Date().toISOString() });
      state.audit.write(makeAuditRecord('chat', 'chat.response', { customerId: customer?.id ?? null, sessionId, swarmRunId, agentsInvolved: [...new Set(swarmThread.map((m) => m.agent))] }));

      send({ type: 'done', synthesis, swarmRunId, sessionId, customer: customerData });

    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }

    return reply; // Dice a Fastify che la risposta è già stata gestita
  });

  // ─── Chat Sessions endpoints ──────────────────────────────────────────────
  app.get('/api/chat/sessions', async (req, reply) => {
    if (ensurePermission(req, reply, 'consult:read') === null) return;
    const { customerId } = req.query as { customerId?: string };
    return { sessions: state.conversations.listSessions(customerId) };
  });

  app.get<{ Params: { sessionId: string } }>('/api/chat/sessions/:sessionId', async (req, reply) => {
    if (ensurePermission(req, reply, 'consult:read') === null) return;
    const session = state.conversations.getSession(req.params.sessionId);
    if (!session) return reply.code(404).send({ error: 'sessione non trovata' });
    const messages = state.conversations.listMessages(req.params.sessionId);
    return { session, messages };
  });

  // ─── NLP Intake: testo libero → dati strutturati ────────────────────────────

  app.post<{ Body: { text: string } }>('/api/assist/intake-nlp', async (req, reply) => {
    if (ensurePermission(req, reply, 'inbound:read') === null) return;
    const { text } = req.body;
    if (!text?.trim()) return reply.code(400).send({ error: 'text è obbligatorio' });

    // ── Fallback parser (regex) quando LLM non è configurato ──
    function fallbackParse(raw: string): Record<string, unknown> {
      const phoneMatch = raw.match(/(?:\+?39\s?)?(?:0\d{6,10}|3\d{9})/);
      const phone = phoneMatch?.[0]?.replace(/\s/g, '') ?? '';
      const catMap: Array<[string, RegExp]> = [
        ['PC PORTATILE', /portati|laptop|notebook/i],
        ['PC FISSO', /fisso|desktop|tower/i],
        ['SMARTPHONE', /smartphone|iphone|samsung.*galaxy|android/i],
        ['TABLET', /tablet|ipad/i],
        ['CELLULARE', /cellulare|telefonino/i],
        ['STAMPANTE', /stampa|printer|epson|canon|hp/i],
        ['TELEVISORE', /tv|televisor|monitor/i],
        ['CONSOLE', /playstation|ps[45]|xbox|nintendo/i],
      ];
      let deviceCategory = 'VARIE';
      for (const [cat, re] of catMap) { if (re.test(raw)) { deviceCategory = cat; break; } }
      const brandRe = /\b(apple|samsung|lg|asus|acer|dell|hp|lenovo|huawei|xiaomi|oppo|realme|honor|corsair|logitech|microsoft|sony)\b/i;
      const brand = raw.match(brandRe)?.[1] ?? undefined;
      // Rough name extraction: first-looking capitalized words before device mention
      const nameMatch = raw.match(/^([A-ZÀÁÈÉÌÍÒÓÙÚ][a-zàáèéìíòóùú]+(?:\s+[A-ZÀÁÈÉÌÍÒÓÙÚ][a-zàáèéìíòóùú]+){0,2})/);
      const customerName = nameMatch?.[1] ?? undefined;
      return { customerName, phone, deviceCategory, brand, model: undefined, serialNumber: undefined, issueDescription: raw.trim(), hasWarranty: false, estimatedPrice: null, signals: [] };
    }

    if (!state.llm) {
      const parsed = fallbackParse(text);
      return { parsed, provider: 'fallback', rawText: text };
    }

    const systemPrompt = `Sei un assistente per l'accettazione di assistenza tecnica in un negozio di elettronica italiano.
Il tuo compito è estrarre i dati strutturati dal testo parlato/scritto dall'operatore.
Rispondi SOLO con JSON valido, senza markdown, senza spiegazioni.
I valori non trovati devono essere null o stringa vuota.
deviceCategory deve essere uno di: "PC PORTATILE","PC FISSO","SMARTPHONE","TABLET","CELLULARE","STAMPANTE","TELEVISORE","CONSOLE","VARIE".`;

    const userPrompt = `Estrai i dati da questo testo di accettazione assistenza:
"${text}"

Restituisci JSON con questi campi:
{
  "customerName": "nome e cognome del cliente",
  "phone": "numero telefono (solo cifre, no spazi)",
  "deviceCategory": "categoria dispositivo",
  "brand": "marca",
  "model": "modello esatto",
  "serialNumber": "numero seriale se presente",
  "issueDescription": "descrizione completa e dettagliata del problema dichiarato dal cliente",
  "hasWarranty": false,
  "estimatedPrice": null,
  "signals": ["array di tag: gamer|network-issue|hardware-fail|screen|battery|charging|water-damage|slow|virus|..."]
}`;

    try {
      const res = await state.llm.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { maxTokens: 600, temperature: 0.2 }
      );
      let parsed: Record<string, unknown>;
      try {
        // Strip markdown code fences if LLM wraps in ```json
        const clean = res.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(clean) as Record<string, unknown>;
      } catch {
        parsed = fallbackParse(text);
        parsed['llmRaw'] = res.content;
      }
      return { parsed, provider: res.provider, model: res.model, rawText: text };
    } catch (err) {
      const parsed = fallbackParse(text);
      return { parsed, provider: 'fallback', error: err instanceof Error ? err.message : String(err), rawText: text };
    }
  });

  // ─── Scheda assistenza HTML (stampabile) ──────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/assist/tickets/:id/scheda', async (req, reply) => {
    if (ensurePermission(req, reply, 'inbound:read') === null) return;
    const ticket = state.assistance.list().find((t) => t.id === req.params.id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket non trovato' });

    const customer = ticket.customerId ? state.customers.getById(ticket.customerId) : undefined;
    const env = process.env;

    const co = {
      name: env.COMPANY_NAME ?? '',
      address: `${env.COMPANY_ADDRESS ?? ''}, ${env.COMPANY_CITY ?? ''}`,
      phone: env.COMPANY_PHONE ?? '',
      phone2: env.COMPANY_PHONE2 ?? '',
      email: env.COMPANY_EMAIL ?? '',
      pec: env.COMPANY_PEC ?? '',
      website: env.COMPANY_WEBSITE ?? '',
      vat: env.COMPANY_VAT ?? '',
      cf: env.COMPANY_CF ?? '',
    };

    const dateStr = new Date(ticket.createdAt).toLocaleDateString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const ticketNum = ticket.id.replace('ticket_', '').toUpperCase();
    const customerName = ticket.customerName ?? customer?.fullName ?? '—';
    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Scheda Assistenza ${ticketNum}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:12mm}
  @media print{body{padding:0}@page{size:A4;margin:12mm}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #c00;padding-bottom:8px;margin-bottom:10px}
  .co-name{font-size:18px;font-weight:700;color:#c00}
  .co-details{font-size:10px;line-height:1.6;color:#333}
  .ticket-ref{text-align:right}
  .ticket-ref .num{font-size:22px;font-weight:700;color:#1a3d6b}
  .ticket-ref .lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.05em}
  .section{border:1px solid #bbb;border-radius:4px;margin-bottom:8px;overflow:hidden}
  .section-title{background:#1a3d6b;color:#fff;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:4px 8px}
  .fields{display:grid;gap:0}
  .row{display:flex;border-top:1px solid #ddd}
  .row:first-child{border-top:none}
  .field{flex:1;padding:5px 8px;border-right:1px solid #ddd}
  .field:last-child{border-right:none}
  .field-2{flex:2}
  .field-3{flex:3}
  .lbl{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:2px}
  .val{font-size:11px;font-weight:600;min-height:14px}
  .bigtext{padding:8px;min-height:50px;font-size:11px;line-height:1.6;white-space:pre-wrap}
  .footer{display:flex;justify-content:space-between;margin-top:12px;gap:20px}
  .sig-box{flex:1;border-top:1px solid #bbb;padding-top:6px;font-size:10px;color:#555}
  .barcode-placeholder{font-family:monospace;font-size:9px;letter-spacing:.1em;color:#888;border:1px dashed #ccc;padding:4px 8px;display:inline-block;border-radius:3px}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;color:rgba(200,0,0,.04);font-weight:900;pointer-events:none;z-index:-1}
  .warn{color:#c00;font-size:9px}
  .status-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .status-pending{background:#fef3c7;color:#92400e}
  .status-repair{background:#d1fae5;color:#065f46}
  .status-not-worth{background:#fee2e2;color:#991b1b}
  .no-print{margin-top:14px;text-align:center}
  @media print{.no-print{display:none}}
  button.print-btn{background:#1a3d6b;color:#fff;border:none;padding:10px 24px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}
  button.print-btn:hover{background:#153168}
</style>
</head>
<body>
<div class="watermark">ASSISTENZA</div>

<!-- Header -->
<div class="header">
  <div>
    <div class="co-name">${co.name}</div>
    <div class="co-details">
      ${co.address}<br>
      Tel: ${co.phone}${co.phone2 ? ' / ' + co.phone2 : ''}<br>
      ${co.email}${co.pec ? ' | PEC: ' + co.pec : ''}<br>
      ${co.website ? co.website + ' | ' : ''}C.F./P.Iva: ${co.vat}
    </div>
  </div>
  <div class="ticket-ref">
    <div class="lbl">Scheda di Assistenza</div>
    <div class="num">${ticketNum}</div>
    <div class="lbl">Data ritiro: ${dateStr}</div>
    <div style="margin-top:4px">
      <span class="status-pill status-${ticket.outcome === 'repair' ? 'repair' : ticket.outcome === 'not-worth-repairing' ? 'not-worth' : 'pending'}">
        ${ticket.outcome === 'repair' ? 'In Riparazione' : ticket.outcome === 'not-worth-repairing' ? 'Non Conveniente' : 'Accettato'}
      </span>
    </div>
    <div style="margin-top:6px"><span class="barcode-placeholder">*${ticketNum}*</span></div>
  </div>
</div>

<!-- Cliente -->
<div class="section">
  <div class="section-title">Cliente</div>
  <div class="fields">
    <div class="row">
      <div class="field field-3"><span class="lbl">Cognome e Nome</span><div class="val">${customerName}</div></div>
      <div class="field"><span class="lbl">Telefono / GSM</span><div class="val">${ticket.phoneLookup}</div></div>
      <div class="field field-2"><span class="lbl">eMail</span><div class="val">${ticket.customerEmail ?? customer?.email ?? '—'}</div></div>
    </div>
    <div class="row">
      <div class="field field-3"><span class="lbl">Indirizzo</span><div class="val">—</div></div>
      <div class="field"><span class="lbl">Cod. Cliente</span><div class="val">${customer?.id ?? ticket.customerId ?? 'PROVVISORIO'}</div></div>
      <div class="field field-2">${ticket.provisionalCustomer ? '<span class="warn">⚠ Cliente provvisorio — non presente in anagrafica</span>' : ''}</div>
    </div>
  </div>
</div>

<!-- Prodotto -->
<div class="section">
  <div class="section-title">Prodotto / Apparecchiatura</div>
  <div class="fields">
    <div class="row">
      <div class="field field-2"><span class="lbl">Categoria</span><div class="val">${ticket.deviceType}</div></div>
      <div class="field field-2"><span class="lbl">Marca</span><div class="val">${ticket.brand ?? '—'}</div></div>
      <div class="field field-3"><span class="lbl">Modello</span><div class="val">${ticket.model ?? '—'}</div></div>
    </div>
    <div class="row">
      <div class="field field-2"><span class="lbl">Nr. Serie</span><div class="val">${ticket.serialNumber ?? '—'}</div></div>
      <div class="field"><span class="lbl">Garanzia</span><div class="val">${ticket.hasWarranty ? 'Sì' : 'No'}</div></div>
      <div class="field"><span class="lbl">Preventivo € </span><div class="val">${ticket.estimatedPrice != null ? ticket.estimatedPrice.toFixed(2) : '—'}</div></div>
      <div class="field field-2"><span class="lbl">Segnali / Tag</span><div class="val" style="font-size:10px">${ticket.inferredSignals.join(', ') || '—'}</div></div>
    </div>
  </div>
</div>

<!-- Difetto dichiarato -->
<div class="section">
  <div class="section-title">Tipo di Guasto / Difetto Dichiarato</div>
  <div class="bigtext">${ticket.issue}</div>
</div>

<!-- Note -->
${ticket.ticketNotes ? `<div class="section">
  <div class="section-title">Note Operative</div>
  <div class="bigtext">${ticket.ticketNotes}</div>
</div>` : ''}

<!-- Esito -->
<div class="section">
  <div class="section-title">Esito Assistenza</div>
  <div class="fields">
    <div class="row">
      <div class="field"><span class="lbl">Esito</span><div class="val">${ticket.diagnosis ?? '—'}</div></div>
      <div class="field"><span class="lbl">Data Rientro</span><div class="val">&nbsp;</div></div>
      <div class="field"><span class="lbl">Importo Pagato €</span><div class="val">&nbsp;</div></div>
      <div class="field"><span class="lbl">Data Riconsegna</span><div class="val">&nbsp;</div></div>
    </div>
    <div class="row">
      <div class="field field-3"><span class="lbl">Note Esito / Riconsegna</span><div class="val" style="min-height:30px">&nbsp;</div></div>
      <div class="field"><span class="lbl">Richiamato</span><div class="val">&nbsp;</div></div>
    </div>
  </div>
</div>

<!-- Footer firme -->
<div class="footer">
  <div class="sig-box">
    <strong>Firma Cliente</strong><br><br><br>
    <span style="font-size:9px;color:#aaa">Il cliente dichiara di aver letto e accettato le condizioni di servizio</span>
  </div>
  <div class="sig-box">
    <strong>Operatore</strong><br><br><br>
    <span style="font-size:9px;color:#aaa">Timbro / Firma</span>
  </div>
  <div class="sig-box">
    <strong>Nota ritiro / privacy</strong><br>
    <span style="font-size:9px;line-height:1.5">I dati personali sono trattati ai sensi del GDPR 679/2016. La presente scheda costituisce ricevuta di accettazione del bene in assistenza.</span>
  </div>
</div>

<div class="no-print" style="margin-top:20px">
  <button class="print-btn" onclick="window.print()">🖨️ Stampa / Salva PDF</button>
  <button style="margin-left:12px;background:none;border:1px solid #ccc;padding:10px 18px;border-radius:6px;cursor:pointer" onclick="window.close()">Chiudi</button>
</div>
</body>
</html>`;

    void reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(html);
  });

  // ── Swarm endpoints ────────────────────────────────────────────────────────
  app.get('/api/swarm/runs', async () => state.swarmRuntime.listRuns(50));

  app.get<{ Params: { runId: string } }>('/api/swarm/runs/:runId', async (req, reply) => {
    const run = state.swarmRuntime.getRun(req.params.runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return state.swarmRuntime.snapshot(req.params.runId);
  });

  app.get<{ Params: { runId: string } }>('/api/swarm/runs/:runId/messages', async (req, reply) => {
    const run = state.swarmRuntime.getRun(req.params.runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return state.swarmRuntime.listMessages(req.params.runId);
  });

  app.get<{ Params: { runId: string } }>('/api/swarm/runs/:runId/steps', async (req, reply) => {
    const run = state.swarmRuntime.getRun(req.params.runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return state.swarmRuntime.listSteps(req.params.runId);
  });

  app.get<{ Params: { runId: string } }>('/api/swarm/runs/:runId/handoffs', async (req, reply) => {
    const run = state.swarmRuntime.getRun(req.params.runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return state.swarmRuntime.listHandoffs(req.params.runId);
  });

  return app;
}
