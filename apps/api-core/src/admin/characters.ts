import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { personas } from '@bisp/personas';
import type { CopilotRMPersona } from '@bisp/integrations-eliza';
import { toElizaLikeCharacter } from '@bisp/integrations-eliza';

export type CharacterKey = keyof typeof personas | string;

export interface CharacterProfile extends CopilotRMPersona {
  key: CharacterKey;
  enabled: boolean;
  modelTier: 'small' | 'medium' | 'large';
  systemInstructions: string;
  apiSources: string[];
  updatedAt: string;
}

const DEFAULT_CHARACTERS_PATH = join(
  process.env.BISPCRM_RUNTIME_DATA_DIR ?? process.env.COPILOTRM_DATA_DIR ?? join(process.cwd(), '..', '..', 'data'),
  'runtime-characters.json'
);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeProfile(input: Partial<CharacterProfile> & { key: string }, base?: CharacterProfile): CharacterProfile {
  const fallback = base ?? {
    key: input.key,
    name: input.key,
    role: 'custom business agent',
    tone: ['pratico'],
    goals: ['supportare le operazioni commerciali'],
    limits: ['rispettare policy e consensi'],
    channels: ['whatsapp'],
    style: ['chiaro'],
    enabled: true,
    modelTier: 'medium',
    systemInstructions: '',
    apiSources: [],
    updatedAt: nowIso(),
  };
  return {
    ...fallback,
    ...input,
    tone: input.tone ?? fallback.tone,
    goals: input.goals ?? fallback.goals,
    limits: input.limits ?? fallback.limits,
    channels: input.channels ?? fallback.channels,
    style: input.style ?? fallback.style,
    apiSources: input.apiSources ?? fallback.apiSources,
    enabled: input.enabled ?? fallback.enabled,
    modelTier: input.modelTier ?? fallback.modelTier,
    systemInstructions: input.systemInstructions ?? fallback.systemInstructions,
    updatedAt: nowIso(),
  };
}

export class CharacterStudioRepository {
  private profiles = new Map<string, CharacterProfile>();

  constructor(private readonly filePath = DEFAULT_CHARACTERS_PATH) {
    this.bootstrap();
  }

  private bootstrap(): void {
    const baseEntries = Object.entries(personas).map(([key, persona]) =>
      normalizeProfile({
        key,
        ...persona,
        enabled: true,
        modelTier: key === 'content' || key === 'compliance' ? 'large' : 'medium',
        systemInstructions: '',
        apiSources: [],
      })
    );
    baseEntries.forEach((p) => this.profiles.set(p.key, p));

    // Agenti di sistema virtuali (Orchestratore, Critico, Moderatore)
    const systemAgents: Array<Partial<CharacterProfile> & { key: string }> = [
      {
        key: 'orchestratore',
        name: 'Orchestratore',
        role: 'coordinatore del team di agenti CopilotRM',
        tone: ['autorevole', 'chiaro', 'sintetico'],
        goals: ['coordinare il team', 'delegare al giusto agente', 'scrivere brief efficaci con @mentions'],
        limits: ['non decide da solo le azioni commerciali', 'non sostituisce gli specialisti'],
        channels: ['internal'],
        style: ['diretto', 'strutturato'],
        enabled: true,
        modelTier: 'small',
        systemInstructions:
          'Analizza la richiesta, leggi il contesto cliente e i dati CRM, poi scrivi un brief taggando con @NomeAgente i 2-3 agenti più rilevanti. Includi il contesto cliente e la domanda specifica per ciascuno.',
        apiSources: ['crm.customers', 'crm.objectives', 'crm.offers'],
      },
      {
        key: 'critico',
        name: 'Critico',
        role: 'revisore avversariale del team',
        tone: ['critico', 'costruttivo', 'diretto'],
        goals: [
          'identificare lacune nelle proposte',
          'prevenire proposte premature o non supportate dai dati',
          'migliorare qualità delle decisioni',
        ],
        limits: ['non blocca senza motivo valido', 'se le proposte sono solide conferma senza sfidare'],
        channels: ['internal'],
        style: ['conciso', 'preciso'],
        enabled: true,
        modelTier: 'small',
        systemInstructions:
          'Analizza le proposte degli agenti e i dati reali del cliente. Identifica: informazioni mancanti, proposte premature, contraddizioni con i dati CRM. Tagga con @NomeAgente gli agenti da sfidare. Se le proposte sono solide e supportate dai dati, conferma.',
        apiSources: [],
      },
      {
        key: 'moderatore',
        name: 'Moderatore',
        role: 'sintetizzatore finale della discussione del team',
        tone: ['equilibrato', 'chiaro', "orientato all'azione"],
        goals: ['sintetizzare il team', "produrre un'azione consigliata chiara per l'operatore"],
        limits: ['non aggiunge opinioni proprie', 'riflette il consenso del team'],
        channels: ['internal'],
        style: ['chiaro', 'actionable'],
        enabled: true,
        modelTier: 'small',
        systemInstructions:
          "Sintetizza la discussione del team in un'azione consigliata chiara per l'operatore: azione immediata + proposta commerciale se rilevante + follow-up. Scrivi come se parlassi all'operatore (max 100 parole).",
        apiSources: [],
      },
    ];
    // Inserisci solo se non già presenti (file runtime prevale)
    for (const agent of systemAgents) {
      if (!this.profiles.has(agent.key)) {
        this.profiles.set(agent.key, normalizeProfile(agent));
      }
    }

    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as CharacterProfile[];
      parsed.forEach((p) => {
        const next = normalizeProfile({ ...p, key: p.key }, this.profiles.get(p.key));
        this.profiles.set(next.key, next);
      });
    } catch {
      // ignore malformed runtime file
    }
  }

  list(): CharacterProfile[] {
    return [...this.profiles.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  get(key: string): CharacterProfile | undefined {
    return this.profiles.get(key);
  }

  upsert(key: string, patch: Partial<CharacterProfile>): CharacterProfile {
    const current = this.profiles.get(key);
    const next = normalizeProfile({ ...patch, key }, current);
    this.profiles.set(key, next);
    return next;
  }

  persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2));
  }

  toElizaLike(key: string): ReturnType<typeof toElizaLikeCharacter> | null {
    const profile = this.profiles.get(key);
    if (!profile) return null;
    const persona: CopilotRMPersona = {
      name: profile.name,
      role: profile.role,
      tone: profile.tone,
      goals: profile.goals,
      limits: profile.limits,
      channels: profile.channels,
      style: profile.style,
    };
    const adapted = toElizaLikeCharacter(persona);
    return {
      ...adapted,
      system: profile.systemInstructions
        ? `${adapted.system}\n\nExtra instructions:\n${profile.systemInstructions}`
        : adapted.system,
    };
  }
}
