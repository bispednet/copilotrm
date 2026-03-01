import React, { useEffect, useState } from 'react';
import { FooterBar, TopHeader } from './components/Chrome';

const API = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? 'http://localhost:4010';

type Role = 'admin' | 'manager' | 'viewer' | 'sales' | 'content' | 'assist';
type Page =
  | 'home'
  | 'datahub'
  | 'assist'
  | 'crm'
  | 'campaigns'
  | 'swarm'
  | 'content'
  | 'outbox'
  | 'ceo'
  | 'admin'
  | 'characters'
  | 'infra'
  | 'ingest';

type ContentCard = {
  id: string;
  source: 'invoice' | 'promo' | 'rss' | 'manual';
  sourceRef: string;
  title: string;
  hook: string;
  blogDraft?: string;
  facebookDraft?: string;
  instagramDraft?: string;
  xDraft?: string;
  telegramDraft?: string;
  wpDraftId?: string;
  publishedAt?: string;
  publishedTo?: string[];
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
};

type Customer = { id: string; fullName: string; phone?: string; segments: string[]; interests?: string[] };
type Offer = { id: string; title: string; category: string; targetSegments: string[]; active: boolean };
type Task = { id: string; kind: string; title: string; status: string; priority: number; assigneeRole: string };
type Ticket = { id: string; phoneLookup: string; deviceType: string; issue: string; outcome: string; inferredSignals: string[] };
type Outbox = { id: string; status: string; draft: { channel: string; audience: string; body: string } };
type Objective = { id: string; name: string; active: boolean; periodStart: string; periodEnd: string; preferredOfferIds: string[] };
type AdminSetting = { key: string; category: string; type?: 'string' | 'boolean' | 'number' | 'secret' | 'string[]'; source: string; value: unknown; description?: string };
type EnvStatus = { key: string; category: string; label: string; configured: boolean };
type Character = {
  key: string;
  name: string;
  role: string;
  tone: string[];
  goals: string[];
  limits: string[];
  channels: string[];
  style: string[];
  enabled: boolean;
  modelTier: 'small' | 'medium' | 'large';
  systemInstructions: string;
  apiSources: string[];
  updatedAt: string;
};
type KPI = {
  objectivesActive: number;
  offersActive: number;
  ticketsOpen: number;
  tasks: { total: number; open: number; done: number; byKind: Record<string, number> };
  outbox: { total: number; pendingApprovals: number; byStatus: Record<string, number>; byChannel: Record<string, number> };
  auditRecords: number;
  swarm?: { total: number; completed: number; failed: number; avgScore: number | null };
};
type SwarmRun = { id: string; eventType: string; status: string; startedAt: string; finishedAt?: string; agentsInvolved: string[]; topActionScore?: number };
type SwarmStep = { id: string; agent: string; stepNo: number; status: string; tasksCreated: number; draftsCreated: number; startedAt: string; finishedAt?: string };
type SwarmMessage = { id: string; fromAgent: string; toAgent?: string; kind: string; content: string; confidence?: number; createdAt: string };
type SwarmHandoff = { id: string; fromAgent: string; toAgent: string; reason: string; blocking: boolean; requiresApproval: boolean; status: string };
type SwarmDetail = { run: SwarmRun; steps: SwarmStep[]; messages: SwarmMessage[]; handoffs: SwarmHandoff[] };

function csvToList(value: string): string[] {
  return value.split(',').map((x) => x.trim()).filter(Boolean);
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [role, setRole] = useState<Role>('admin');
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('copilotrm_manager_theme');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [infra, setInfra] = useState<Record<string, unknown> | null>(null);

  const [lookupPhone, setLookupPhone] = useState('3331112222');
  const [lookupResult, setLookupResult] = useState<Record<string, unknown> | null>(null);
  const [ticketDevice, setTicketDevice] = useState('gaming-pc');
  const [ticketIssue, setTicketIssue] = useState('lag e ping alto');
  const [ticketSignals, setTicketSignals] = useState('gamer,network-issue');
  const [selectedTicketId, setSelectedTicketId] = useState('');

  const [consultCustomerId, setConsultCustomerId] = useState('cust_mario');
  const [consultOfferId, setConsultOfferId] = useState('');
  const [consultPrompt, setConsultPrompt] = useState('Fammi 3 varianti per upsell coerente e non invasivo.');
  const [consultResult, setConsultResult] = useState<Record<string, unknown> | null>(null);

  const [campaignOfferTitle, setCampaignOfferTitle] = useState('Oppo 13 Max');
  const [campaignSegment, setCampaignSegment] = useState('smartphone-upgrade');
  const [campaignPreview, setCampaignPreview] = useState<Record<string, unknown> | null>(null);
  const [campaignLaunch, setCampaignLaunch] = useState<Record<string, unknown> | null>(null);

  const [envStatus, setEnvStatus] = useState<EnvStatus[]>([]);

  const [objectiveName, setObjectiveName] = useState('Nuovo obiettivo commerciale');
  const [selectedPreferredOffers, setSelectedPreferredOffers] = useState<string[]>([]);
  const [selectedStockOffers, setSelectedStockOffers] = useState<string[]>([]);
  const [objectiveMinMargin, setObjectiveMinMargin] = useState('');
  const [objectiveDailyCap, setObjectiveDailyCap] = useState('');
  const [categoryWeightDraft, setCategoryWeightDraft] = useState<Record<string, number>>({ smartphone: 1, computer: 1, tablet: 1, energia: 1, telefonia: 1, assistenza: 1, accessori: 1 });

  const [settingDraft, setSettingDraft] = useState<Record<string, string>>({});
  const [selectedCharacterKey, setSelectedCharacterKey] = useState('');
  const [characterDraft, setCharacterDraft] = useState<Character | null>(null);
  const [characterPreview, setCharacterPreview] = useState<Record<string, unknown> | null>(null);

  const [promoTitle, setPromoTitle] = useState('Promo bundle smartphone + accessori');
  const [promoCategory, setPromoCategory] = useState<'smartphone' | 'hardware' | 'connectivity' | 'accessory' | 'energy'>('smartphone');
  const [promoSegments, setPromoSegments] = useState('smartphone-upgrade,famiglia');
  const [ingestResult, setIngestResult] = useState<Record<string, unknown> | null>(null);

  const [scenarioName, setScenarioName] = useState('smartphonePromo');
  const [scenarioResult, setScenarioResult] = useState<Record<string, unknown> | null>(null);

  const [swarmRuns, setSwarmRuns] = useState<SwarmRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [swarmDetail, setSwarmDetail] = useState<SwarmDetail | null>(null);

  const [contentCards, setContentCards] = useState<ContentCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [contentCardFilter, setContentCardFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  useEffect(() => {
    localStorage.setItem('copilotrm_manager_theme', themeMode);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = themeMode === 'system' ? (mq.matches ? 'dark' : 'light') : themeMode;
      document.documentElement.setAttribute('data-theme', effective);
    };
    apply();
    const onChange = () => apply();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themeMode]);

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers ?? undefined);
    headers.set('x-bisp-role', role);
    return fetch(`${API}${path}`, { ...init, headers });
  }

  async function refreshAll(): Promise<void> {
    const [c, o, t, tk, ob, kp, obj, st, ch, inf, ev] = await Promise.all([
      apiFetch('/api/customers').then((r) => r.json()),
      apiFetch('/api/offers').then((r) => r.json()),
      apiFetch('/api/tasks').then((r) => r.json()),
      apiFetch('/api/assist/tickets').then((r) => r.json()),
      apiFetch('/api/outbox').then((r) => r.json()),
      apiFetch('/api/manager/kpi').then((r) => r.json()),
      apiFetch('/api/manager/objectives').then((r) => r.json()),
      apiFetch('/api/admin/settings').then((r) => r.json()),
      apiFetch('/api/admin/characters').then((r) => r.json()),
      apiFetch('/api/system/infra').then((r) => r.json()),
      apiFetch('/api/admin/env-status').then((r) => r.json()).catch(() => []),
    ]);
    setCustomers(Array.isArray(c) ? c : []);
    setOffers(Array.isArray(o) ? o : []);
    setTasks(Array.isArray(t) ? t : []);
    setTickets(Array.isArray(tk) ? tk : []);
    setOutbox(Array.isArray(ob) ? ob : []);
    setKpi(kp ?? null);
    setObjectives(Array.isArray(obj) ? obj : []);
    setSettings(Array.isArray(st?.items) ? st.items : []);
    setCharacters(Array.isArray(ch) ? ch : []);
    setInfra(inf ?? null);
    setEnvStatus(Array.isArray(ev) ? ev : []);
    if (!selectedCharacterKey && Array.isArray(ch) && ch[0]?.key) {
      setSelectedCharacterKey(ch[0].key);
      setCharacterDraft(ch[0]);
    }
    if (!consultCustomerId && Array.isArray(c) && c[0]?.id) setConsultCustomerId(c[0].id);
  }

  useEffect(() => {
    void refreshAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedCharacterKey) return;
    const found = characters.find((c) => c.key === selectedCharacterKey);
    if (found) setCharacterDraft(found);
  }, [selectedCharacterKey, characters]);

  async function runAction(label: string, fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await fn();
      setLog(`${label}: ok`);
      await refreshAll();
    } catch (error) {
      setLog(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshSwarm(): Promise<void> {
    const runs = await apiFetch('/api/swarm/runs').then((r) => r.json());
    setSwarmRuns(Array.isArray(runs) ? runs : []);
  }

  async function loadRunDetail(runId: string): Promise<void> {
    const detail = await apiFetch(`/api/swarm/runs/${runId}`).then((r) => r.json());
    setSwarmDetail(detail ?? null);
    setSelectedRunId(runId);
  }

  async function refreshContentCards(filter?: 'pending' | 'approved' | 'rejected'): Promise<void> {
    const qs = filter ? `?status=${filter}` : '';
    const cards = await apiFetch(`/api/content/cards${qs}`).then((r) => r.json());
    setContentCards(Array.isArray(cards) ? cards : []);
  }

  async function approveCard(cardId: string, action: 'approve' | 'reject'): Promise<void> {
    await apiFetch(`/api/content/cards/${cardId}/${action}`, { method: 'PATCH' });
    await refreshContentCards(contentCardFilter === 'all' ? undefined : contentCardFilter);
    if (selectedCardId === cardId) setSelectedCardId(null);
  }

  const nav: Array<{ key: Page; label: string }> = [
    { key: 'home', label: 'Home / KPI' },
    { key: 'datahub', label: 'Data Hub 360' },
    { key: 'assist', label: 'Assist Desk' },
    { key: 'crm', label: 'CRM Consult' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'swarm', label: 'Swarm Studio' },
    { key: 'content', label: 'Content Cards' },
    { key: 'ingest', label: 'Ingest / Stock' },
    { key: 'outbox', label: 'Outbox / Approvals' },
    { key: 'ceo', label: 'CEO Objectives' },
    { key: 'admin', label: 'Admin Settings' },
    { key: 'characters', label: 'Character Studio' },
    { key: 'infra', label: 'Infra / Queue' },
  ];

  return (
    <>
    <TopHeader
      product="CopilotRM"
      area="Manager Control Room"
      links={[
        { href: 'http://localhost:5175', label: 'Manager' },
        { href: 'http://localhost:5173', label: 'CRM' },
        { href: 'http://localhost:5174', label: 'Assist' },
        { href: 'http://localhost:4010/api/system/infra', label: 'API Status', external: true },
        { href: 'https://github.com/bispednet/copilotrm', label: 'Documentazione', external: true },
      ]}
    />
    <main className="shell appShell">
      <aside className="sidebar card">
        <p className="eyebrow">CopilotRM Control Plane</p>
        <h1>CRM AI Swarm</h1>
        <label>Ruolo simulato</label>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="admin">admin</option>
          <option value="manager">manager</option>
          <option value="sales">sales</option>
          <option value="content">content</option>
          <option value="assist">assist</option>
          <option value="viewer">viewer</option>
        </select>
        <label>Tema</label>
        <select value={themeMode} onChange={(e) => setThemeMode(e.target.value as 'system' | 'light' | 'dark')}>
          <option value="system">system</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
        <nav className="menu">
          {nav.map((item) => (
            <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => setPage(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="crossNav">
          <a href="http://localhost:5173">CRM</a>
          <a href="http://localhost:5174">Assist</a>
          <a href="http://localhost:5175">Control</a>
        </div>
        <button className="ghost" onClick={() => void runAction('refresh', refreshAll)} disabled={busy}>Refresh</button>
        <small className="muted">{log || 'Nessuna azione'}</small>
        <div className="infoPanel" style={{ marginTop: 10 }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>Sala di regia</strong>
          <span style={{ fontSize: 12 }}>
            Usa <code>admin</code> per configurazione completa, <code>manager</code> per obiettivi/approvazioni e <code>viewer</code> per sola lettura.
          </span>
        </div>
      </aside>

      <section className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">Manager Control Room</p>
            <h2 style={{ marginBottom: 6 }}>
              {page === 'home' && 'Panoramica decisionale del sistema'}
              {page === 'datahub' && 'Base dati clienti/offerte con vista operativa'}
              {page === 'assist' && 'Presidio intake assistenza e handoff'}
              {page === 'crm' && 'Copilot commerciale e proposta guidata'}
              {page === 'campaigns' && 'Pianificazione e lancio campagne'}
              {page === 'swarm' && 'Visibilita run agentiche e handoff'}
              {page === 'content' && 'Pipeline contenuti e approvazioni'}
              {page === 'ingest' && 'Ingest dati promo/stock'}
              {page === 'outbox' && 'Moderazione invii multicanale'}
              {page === 'ceo' && 'Obiettivi e leve strategiche'}
              {page === 'admin' && 'Configurazione runtime e integrazioni'}
              {page === 'characters' && 'Character Studio e istruzioni agenti'}
              {page === 'infra' && 'Stato infrastruttura, queue e persistenza'}
            </h2>
            <p className="lede">
              Vista guidata con priorita manageriali: capire stato, decidere, approvare, misurare.
            </p>
          </div>
          <div className="helper" style={{ maxWidth: 360 }}>
            <strong>Azione prioritaria</strong>
            <p style={{ margin: '6px 0 0' }}>
              {page === 'home' && 'Verifica KPI e ultime run, poi apri Swarm o Outbox per agire.'}
              {page === 'ceo' && 'Inserisci obiettivo e offerte preferite per orientare l’orchestrator.'}
              {page === 'admin' && 'Conferma variabili integrazione e salva solo parametri validati.'}
              {!['home', 'ceo', 'admin'].includes(page) && 'Completa il task della pagina e torna su Home per monitorare l’impatto.'}
            </p>
          </div>
        </header>

        {page === 'home' && (
          <>
            <header className="hero card">
              <div>
                <p className="eyebrow">Pannello di controllo — {new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <h2>Benvenuto nel Control Plane</h2>
                <p className="lede">Monitora KPI, swarm runs attive, task in attesa e accedi rapidamente alle funzioni principali.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {([['CEO Objectives', 'ceo'], ['Campagne', 'campaigns'], ['Swarm Studio', 'swarm'], ['Impostazioni', 'admin']] as [string, Page][]).map(([label, key]) => (
                  <button key={key} className="ghost" style={{ padding: '6px 14px', fontSize: 13 }} onClick={() => setPage(key)}>{label}</button>
                ))}
              </div>
            </header>

            <section className="statsGrid">
              <article className="card stat"><span>Obiettivi attivi</span><strong>{kpi?.objectivesActive ?? 0}</strong></article>
              <article className="card stat"><span>Offerte attive</span><strong>{kpi?.offersActive ?? 0}</strong></article>
              <article className="card stat"><span>Ticket aperti</span><strong>{kpi?.ticketsOpen ?? 0}</strong></article>
              <article className="card stat"><span>Pending approval</span><strong>{kpi?.outbox.pendingApprovals ?? 0}</strong></article>
              <article className="card stat"><span>Swarm runs</span><strong>{kpi?.swarm?.total ?? 0}</strong></article>
              <article className="card stat"><span>Swarm completati</span><strong>{kpi?.swarm?.completed ?? 0}</strong></article>
              <article className="card stat"><span>Avg top score</span><strong>{kpi?.swarm?.avgScore != null ? kpi.swarm.avgScore.toFixed(2) : '—'}</strong></article>
              <article className="card stat"><span>Audit records</span><strong>{kpi?.auditRecords ?? 0}</strong></article>
            </section>

            <section className="grid twoCols">
              <article className="card">
                <h3>Ultime run Swarm</h3>
                {swarmRuns.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nessuna run — attiva uno scenario per avviarne una.</p>}
                {swarmRuns.slice(0, 6).map((run) => (
                  <div key={run.id} onClick={() => { setPage('swarm'); void loadRunDetail(run.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 13 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: run.status === 'completed' ? '#22c55e' : run.status === 'failed' ? '#ef4444' : '#f59e0b', flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{run.eventType}</span>
                    <span className="muted">{run.agentsInvolved.length} agent{run.agentsInvolved.length !== 1 ? 'i' : 'e'}</span>
                    <span className="muted">{new Date(run.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
                {swarmRuns.length === 0 && (
                  <button className="ghost" style={{ marginTop: 8, fontSize: 13 }} onClick={() => void refreshSwarm()}>Carica runs</button>
                )}
              </article>

              <article className="card">
                <h3>Task in attesa</h3>
                {tasks.filter(t => t.status === 'pending' || t.status === 'open').length === 0
                  ? <p className="muted" style={{ fontSize: 13 }}>Nessun task in attesa.</p>
                  : tasks.filter(t => t.status === 'pending' || t.status === 'open').slice(0, 8).map((task) => (
                      <div key={task.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ flex: 1 }}>{task.title}</span>
                        <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 11, background: 'var(--accent-2)', color: '#fff' }}>{task.assigneeRole}</span>
                      </div>
                    ))
                }
              </article>
            </section>
          </>
        )}

        {page === 'datahub' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Customer 360</h2>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>ID</th><th>Nome</th><th>Phone</th><th>Segmenti</th></tr></thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td>{c.id}</td><td>{c.fullName}</td><td>{c.phone ?? '-'}</td><td>{c.segments.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="card">
              <h2>Offers Catalog</h2>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>ID</th><th>Titolo</th><th>Categoria</th><th>Target</th></tr></thead>
                  <tbody>
                    {offers.map((o) => (
                      <tr key={o.id}>
                        <td>{o.id}</td><td>{o.title}</td><td>{o.category}</td><td>{o.targetSegments.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {page === 'assist' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Accettazione assistenza</h2>
              <label>Telefono</label>
              <input value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} />
              <label>Device type</label>
              <input value={ticketDevice} onChange={(e) => setTicketDevice(e.target.value)} />
              <label>Issue</label>
              <input value={ticketIssue} onChange={(e) => setTicketIssue(e.target.value)} />
              <label>Signals (csv)</label>
              <input value={ticketSignals} onChange={(e) => setTicketSignals(e.target.value)} />
              <div className="btnRow">
                <button
                  onClick={() =>
                    void runAction('assist.lookup', async () => {
                      const res = await apiFetch(`/api/assist/customers/lookup?phone=${encodeURIComponent(lookupPhone)}`);
                      setLookupResult(await res.json());
                    })
                  }
                  disabled={busy}
                >
                  Lookup cliente
                </button>
                <button
                  className="ghost"
                  onClick={() =>
                    void runAction('assist.create_ticket', async () => {
                      await apiFetch('/api/assist/tickets', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          phone: lookupPhone,
                          deviceType: ticketDevice,
                          issue: ticketIssue,
                          inferredSignals: csvToList(ticketSignals),
                        }),
                      });
                    })
                  }
                  disabled={busy}
                >
                  Crea ticket
                </button>
              </div>
              <details>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Dettaglio tecnico lookup (JSON)</summary>
                <pre>{JSON.stringify(lookupResult ?? {}, null, 2)}</pre>
              </details>
            </article>
            <article className="card">
              <h2>Ticket & handoff</h2>
              <label>Ticket ID per outcome</label>
              <input value={selectedTicketId} onChange={(e) => setSelectedTicketId(e.target.value)} placeholder="ticket_xxx" />
              <button
                onClick={() =>
                  void runAction('assist.outcome', async () => {
                    await apiFetch(`/api/assist/tickets/${selectedTicketId}/outcome`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        outcome: 'not-worth-repairing',
                        diagnosis: 'riparazione superiore al valore',
                        inferredSignals: ['gamer', 'lag'],
                      }),
                    });
                  })
                }
                disabled={busy || !selectedTicketId}
              >
                Chiudi con outcome + orchestrator
              </button>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>ID</th><th>Phone</th><th>Issue</th><th>Outcome</th></tr></thead>
                  <tbody>{tickets.map((t) => <tr key={t.id}><td>{t.id}</td><td>{t.phoneLookup}</td><td>{t.issue}</td><td>{t.outcome}</td></tr>)}</tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {page === 'crm' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Consult Agent</h2>
              <label>Cliente</label>
              <select value={consultCustomerId} onChange={(e) => setConsultCustomerId(e.target.value)}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
              </select>
              <label>Offer ID (opzionale)</label>
              <input value={consultOfferId} onChange={(e) => setConsultOfferId(e.target.value)} placeholder="offer_xxx" />
              <label>Prompt</label>
              <textarea rows={4} value={consultPrompt} onChange={(e) => setConsultPrompt(e.target.value)} />
              <button
                onClick={() =>
                  void runAction('consult.proposal', async () => {
                    const res = await apiFetch('/api/consult/proposal', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ customerId: consultCustomerId, offerId: consultOfferId || undefined, prompt: consultPrompt }),
                    });
                    setConsultResult(await res.json());
                  })
                }
                disabled={busy}
              >
                Genera proposta
              </button>
            </article>
            <article className="card">
              <h2>Output proposta</h2>
              <details open>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Output completo proposta</summary>
                <pre>{JSON.stringify(consultResult ?? {}, null, 2)}</pre>
              </details>
            </article>
          </section>
        )}

        {page === 'campaigns' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Campaign Planner</h2>
              <label>Offer title contains</label>
              <input value={campaignOfferTitle} onChange={(e) => setCampaignOfferTitle(e.target.value)} />
              <label>Segment</label>
              <input value={campaignSegment} onChange={(e) => setCampaignSegment(e.target.value)} />
              <div className="btnRow">
                <button
                  onClick={() =>
                    void runAction('campaign.preview', async () => {
                      const res = await apiFetch('/api/campaigns/preview', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ offerTitle: campaignOfferTitle, segment: campaignSegment }),
                      });
                      setCampaignPreview(await res.json());
                    })
                  }
                  disabled={busy}
                >
                  Preview
                </button>
                <button
                  className="ghost"
                  onClick={() =>
                    void runAction('campaign.launch', async () => {
                      const res = await apiFetch('/api/campaigns/launch', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ offerTitle: campaignOfferTitle, segment: campaignSegment }),
                      });
                      setCampaignLaunch(await res.json());
                    })
                  }
                  disabled={busy}
                >
                  Launch
                </button>
              </div>
            </article>
            <article className="card">
              <h3>Preview</h3>
              <details open>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>JSON preview targeting</summary>
                <pre>{JSON.stringify(campaignPreview ?? {}, null, 2)}</pre>
              </details>
              <h3>Launch</h3>
              <details open>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>JSON launch campagna</summary>
                <pre>{JSON.stringify(campaignLaunch ?? {}, null, 2)}</pre>
              </details>
            </article>
          </section>
        )}

        {page === 'swarm' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Swarm Studio</h2>
              <div className="btnRow">
                <button onClick={() => void runAction('swarm.refresh', refreshSwarm)} disabled={busy}>Aggiorna runs</button>
              </div>
              <div className="tableWrap" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr><th>Status</th><th>Event</th><th>Agenti</th><th>Score</th><th>Avviato</th><th></th></tr>
                  </thead>
                  <tbody>
                    {swarmRuns.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', opacity: 0.5 }}>Nessuna run. Esegui uno scenario o chiudi un ticket.</td></tr>
                    )}
                    {swarmRuns.map((r) => (
                      <tr key={r.id} style={{ cursor: 'pointer', background: selectedRunId === r.id ? 'var(--color-accent-subtle, #eef)' : undefined }}
                        onClick={() => void loadRunDetail(r.id)}>
                        <td>
                          <span style={{ fontWeight: 600, color: r.status === 'completed' ? '#2a2' : r.status === 'failed' ? '#c33' : '#b80' }}>
                            {r.status === 'completed' ? '✓' : r.status === 'failed' ? '✗' : '⏳'} {r.status}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{r.eventType}</td>
                        <td style={{ fontSize: '0.8em' }}>{r.agentsInvolved.join(', ')}</td>
                        <td>{r.topActionScore != null ? r.topActionScore.toFixed(2) : '—'}</td>
                        <td style={{ fontSize: '0.75em' }}>{new Date(r.startedAt).toLocaleTimeString()}</td>
                        <td><button className="ghost" onClick={(e) => { e.stopPropagation(); void loadRunDetail(r.id); }}>Dettaglio</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <hr style={{ margin: '16px 0' }} />
              <h3>Scenario tester</h3>
              <label>Scenario demo</label>
              <select value={scenarioName} onChange={(e) => setScenarioName(e.target.value)}>
                <option value="repairNotWorth">repairNotWorth</option>
                <option value="gamerLag">gamerLag</option>
                <option value="hardwareInvoice">hardwareInvoice</option>
                <option value="smartphonePromo">smartphonePromo</option>
                <option value="complaintEmail">complaintEmail</option>
              </select>
              <div className="btnRow">
                <button onClick={() => void runAction('scenario.run', async () => {
                  const res = await apiFetch(`/api/scenarios/${scenarioName}/run`, { method: 'POST' });
                  setScenarioResult(await res.json());
                  await refreshSwarm();
                })} disabled={busy}>Run scenario</button>
                <button className="ghost" onClick={() => void runAction('orchestrate.custom', async () => {
                  const res = await apiFetch('/api/orchestrate', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ event: { id: `evt_${Date.now()}`, type: 'manager.objective.updated', occurredAt: new Date().toISOString(), payload: { note: 'manual orchestrate test' } } }),
                  });
                  setScenarioResult(await res.json());
                  await refreshSwarm();
                })} disabled={busy}>Run custom event</button>
              </div>
            </article>
            <article className="card">
              {swarmDetail && selectedRunId ? (
                <>
                  <h3>Run {swarmDetail.run.id}</h3>
                  <p style={{ fontSize: '0.8em', opacity: 0.7 }}>
                    {swarmDetail.run.eventType} · durata {swarmDetail.run.finishedAt
                      ? `${((new Date(swarmDetail.run.finishedAt).getTime() - new Date(swarmDetail.run.startedAt).getTime()) / 1000).toFixed(1)}s`
                      : 'running'}
                    {swarmDetail.run.topActionScore != null && ` · top score ${swarmDetail.run.topActionScore.toFixed(2)}`}
                  </p>
                  <h4>Steps</h4>
                  <div className="tableWrap">
                    <table>
                      <thead><tr><th>#</th><th>Agente</th><th>Status</th><th>Tasks</th><th>Drafts</th></tr></thead>
                      <tbody>
                        {swarmDetail.steps.map((s) => (
                          <tr key={s.id}>
                            <td>{s.stepNo}</td>
                            <td style={{ fontWeight: 600 }}>{s.agent}</td>
                            <td><span style={{ color: s.status === 'completed' ? '#2a2' : s.status === 'failed' ? '#c33' : '#b80' }}>{s.status}</span></td>
                            <td>{s.tasksCreated}</td>
                            <td>{s.draftsCreated}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h4 style={{ marginTop: 12 }}>Messaggi</h4>
                  <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: '0.78em', lineHeight: 1.6 }}>
                    {swarmDetail.messages.map((m) => (
                      <div key={m.id} style={{ padding: '3px 0', borderBottom: '1px solid var(--color-border, #eee)' }}>
                        <span style={{ fontWeight: 700 }}>{m.fromAgent}</span>
                        {m.toAgent && <span style={{ opacity: 0.6 }}> → {m.toAgent}</span>}
                        <span style={{ marginLeft: 6, background: m.kind === 'handoff' ? '#ffd' : m.kind === 'decision' ? '#dfd' : '#eee', padding: '1px 4px', borderRadius: 3, fontSize: '0.85em' }}>{m.kind}</span>
                        <span style={{ marginLeft: 8, opacity: 0.85 }}>{m.content.length > 120 ? m.content.slice(0, 120) + '…' : m.content}</span>
                      </div>
                    ))}
                  </div>
                  {swarmDetail.handoffs.length > 0 && (
                    <>
                      <h4 style={{ marginTop: 12 }}>Handoff chain</h4>
                      <div style={{ fontSize: '0.8em' }}>
                        {swarmDetail.handoffs.map((h) => (
                          <div key={h.id} style={{ padding: '3px 0' }}>
                            <span style={{ fontWeight: 600 }}>{h.fromAgent}</span>
                            <span style={{ margin: '0 4px' }}>→</span>
                            <span style={{ fontWeight: 600 }}>{h.toAgent}</span>
                            <span style={{ marginLeft: 8, opacity: 0.65 }}>{h.reason}</span>
                            <span style={{ marginLeft: 6, color: h.status === 'executed' ? '#2a2' : '#b80' }}>· {h.status}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <h3>Swarm output scenario</h3>
                  <pre>{JSON.stringify(scenarioResult ?? {}, null, 2)}</pre>
                </>
              )}
            </article>
          </section>
        )}

        {page === 'ingest' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Ingest stock/promo</h2>
              <button onClick={() => void runAction('ingest.danea', async () => {
                const res = await apiFetch('/api/ingest/danea/sync', { method: 'POST' });
                setIngestResult(await res.json());
              })} disabled={busy}>Sync Danea stub</button>
              <label>Titolo promo</label>
              <input value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} />
              <label>Categoria</label>
              <select value={promoCategory} onChange={(e) => setPromoCategory(e.target.value as typeof promoCategory)}>
                <option value="smartphone">smartphone</option>
                <option value="hardware">hardware</option>
                <option value="connectivity">connectivity</option>
                <option value="accessory">accessory</option>
                <option value="energy">energy</option>
              </select>
              <label>Target segments (csv)</label>
              <input value={promoSegments} onChange={(e) => setPromoSegments(e.target.value)} />
              <button className="ghost" onClick={() => void runAction('ingest.promo', async () => {
                const res = await apiFetch('/api/ingest/promo', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ title: promoTitle, category: promoCategory, targetSegments: csvToList(promoSegments) }),
                });
                setIngestResult(await res.json());
              })} disabled={busy}>Ingest promo</button>
            </article>
            <article className="card">
              <h3>Ingest output</h3>
              <details open>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Risposta completa ingest</summary>
                <pre>{JSON.stringify(ingestResult ?? {}, null, 2)}</pre>
              </details>
            </article>
          </section>
        )}

        {page === 'outbox' && (
          <section className="card">
            <h2>Outbox moderation</h2>
            <div className="tableWrap">
              <table>
                <thead><tr><th>ID</th><th>Channel</th><th>Status</th><th>Body</th><th>Actions</th></tr></thead>
                <tbody>
                  {outbox.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.draft.channel}</td>
                      <td>{item.status}</td>
                      <td>{item.draft.body}</td>
                      <td>
                        <button
                          className="ghost"
                          onClick={() =>
                            void runAction('outbox.approve_send', async () => {
                              await apiFetch(`/api/outbox/${item.id}/approve-send`, {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ actor: 'manager-ui' }),
                              });
                            })
                          }
                          disabled={busy}
                        >
                          Approve+Send
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {page === 'ceo' && (() => {
          const CEO_CATEGORIES = ['smartphone', 'computer', 'tablet', 'energia', 'telefonia', 'assistenza', 'accessori'];
          const toggleOffer = (id: string, list: string[], setter: (v: string[]) => void) =>
            setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
          return (
          <section className="grid twoCols">
            <article className="card">
              <h2>CEO Objectives</h2>
              <small className="muted" style={{ display: 'block', marginBottom: 12 }}>Definisci le priorità commerciali del mese. Gli agenti le usano per valutare e proporre azioni.</small>

              <label>Nome obiettivo</label>
              <input value={objectiveName} onChange={(e) => setObjectiveName(e.target.value)} placeholder="Es: Spinta smartphone Q1" />

              <label style={{ marginTop: 12 }}>Offerte da spingere (priorità di vendita)</label>
              <small className="muted" style={{ fontSize: 11 }}>Seleziona le offerte che gli agenti devono promuovere attivamente.</small>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {offers.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Caricamento offerte...</span>}
                {offers.filter(o => o.active).map((o) => (
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: `1px solid ${selectedPreferredOffers.includes(o.id) ? 'var(--accent)' : 'var(--line)'}`, borderRadius: 20, cursor: 'pointer', fontSize: 12,
                    background: selectedPreferredOffers.includes(o.id) ? 'var(--accent)' : 'transparent',
                    color: selectedPreferredOffers.includes(o.id) ? '#fff' : 'inherit' }}>
                    <input type="checkbox" hidden checked={selectedPreferredOffers.includes(o.id)} onChange={() => toggleOffer(o.id, selectedPreferredOffers, setSelectedPreferredOffers)} />
                    {o.title}
                  </label>
                ))}
              </div>

              <label style={{ marginTop: 12 }}>Offerte in smaltimento scorte</label>
              <small className="muted" style={{ fontSize: 11 }}>Prodotti con stock da liquidare — l'agente li propone per primi.</small>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {offers.filter(o => o.active).map((o) => (
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: `1px solid ${selectedStockOffers.includes(o.id) ? '#f59e0b' : 'var(--line)'}`, borderRadius: 20, cursor: 'pointer', fontSize: 12,
                    background: selectedStockOffers.includes(o.id) ? '#f59e0b' : 'transparent',
                    color: selectedStockOffers.includes(o.id) ? '#fff' : 'inherit' }}>
                    <input type="checkbox" hidden checked={selectedStockOffers.includes(o.id)} onChange={() => toggleOffer(o.id, selectedStockOffers, setSelectedStockOffers)} />
                    {o.title}
                  </label>
                ))}
              </div>

              <label style={{ marginTop: 14 }}>Peso per categoria</label>
              <small className="muted" style={{ fontSize: 11 }}>1× = neutro · 2× = doppia priorità · 0× = ignora categoria</small>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {CEO_CATEGORIES.map((cat) => (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ minWidth: 90, fontSize: 13, textTransform: 'capitalize' }}>{cat}</span>
                    <input type="range" min={0} max={3} step={0.1} style={{ flex: 1 }}
                      value={categoryWeightDraft[cat] ?? 1}
                      onChange={(e) => setCategoryWeightDraft((prev) => ({ ...prev, [cat]: Number(e.target.value) }))} />
                    <span style={{ minWidth: 32, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{(categoryWeightDraft[cat] ?? 1).toFixed(1)}×</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label>Margine minimo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" min={0} max={100} style={{ width: 72 }} value={objectiveMinMargin} onChange={(e) => setObjectiveMinMargin(e.target.value)} placeholder="15" />
                    <span className="muted" style={{ fontSize: 12 }}>%</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label>Contatti max/giorno</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" min={1} max={500} style={{ width: 72 }} value={objectiveDailyCap} onChange={(e) => setObjectiveDailyCap(e.target.value)} placeholder="50" />
                    <span className="muted" style={{ fontSize: 12 }}>/ giorno</span>
                  </div>
                </div>
              </div>

              <button style={{ marginTop: 16 }}
                onClick={() =>
                  void runAction('objective.create', async () => {
                    await apiFetch('/api/manager/objectives', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        id: `obj_${Date.now()}`,
                        name: objectiveName,
                        active: true,
                        periodStart: new Date().toISOString(),
                        periodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
                        preferredOfferIds: selectedPreferredOffers,
                        stockClearanceOfferIds: selectedStockOffers,
                        minMarginPct: objectiveMinMargin ? Number(objectiveMinMargin) : undefined,
                        dailyContactCapacity: objectiveDailyCap ? Number(objectiveDailyCap) : undefined,
                        categoryWeights: categoryWeightDraft,
                      }),
                    });
                  })
                }
                disabled={busy}
              >
                Crea obiettivo
              </button>
            </article>
            <article className="card">
              <h3>Obiettivi correnti</h3>
              {objectives.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nessun obiettivo attivo.</p>}
              {objectives.map((o) => {
                const ext = o as unknown as { minMarginPct?: number; dailyContactCapacity?: number; stockClearanceOfferIds?: string[] };
                return (
                  <div key={o.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.active ? '#22c55e' : '#6b7280', flexShrink: 0 }} />
                      <strong style={{ fontSize: 14 }}>{o.name}</strong>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {o.preferredOfferIds?.length > 0 && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--accent)', color: '#fff' }}>{o.preferredOfferIds.length} offerte preferite</span>}
                      {ext.stockClearanceOfferIds && ext.stockClearanceOfferIds.length > 0 && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#f59e0b', color: '#fff' }}>{ext.stockClearanceOfferIds.length} in smaltimento</span>}
                      {ext.minMarginPct != null && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--panel)', border: '1px solid var(--line)' }}>margin ≥{ext.minMarginPct}%</span>}
                      {ext.dailyContactCapacity != null && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--panel)', border: '1px solid var(--line)' }}>{ext.dailyContactCapacity} contatti/gg</span>}
                    </div>
                  </div>
                );
              })}
            </article>
          </section>
          );
        })()}

        {page === 'admin' && (() => {
          const CATEGORY_LABELS: Record<string, string> = {
            models: 'Modelli AI', channels: 'Canali di comunicazione', autoposting: 'Auto-posting social',
            agents: 'Agenti', system: 'Sistema', llm: 'LLM', telegram: 'Telegram', email: 'Email',
            whatsapp: 'WhatsApp', wordpress: 'WordPress', hardware: 'Hardware / Fornitori',
            danea: 'Danea Easyfatt', social: 'Social media', company: 'Azienda',
          };
          const envByCategory = envStatus.reduce<Record<string, EnvStatus[]>>((acc, e) => {
            (acc[e.category] ??= []).push(e);
            return acc;
          }, {});
          const settingsByCategory = settings.reduce<Record<string, AdminSetting[]>>((acc, s) => {
            (acc[s.category] ??= []).push(s);
            return acc;
          }, {});
          return (
          <>
            <section className="card" style={{ marginBottom: 24 }}>
              <h2>Stato Integrazioni</h2>
              <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Verifiche basate sulla presenza delle variabili d'ambiente. I valori non vengono mai esposti.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {Object.entries(envByCategory).map(([cat, items]) => (
                  <article key={cat} className="card" style={{ padding: '12px 14px' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>{CATEGORY_LABELS[cat] ?? cat}</h4>
                    {items.map((e) => (
                      <div key={e.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
                        <span title={e.key}>{e.label}</span>
                        <span style={{ fontWeight: 700, color: e.configured ? '#22c55e' : '#ef4444', fontSize: 14 }}>{e.configured ? '✓' : '✗'}</span>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </section>

            <section className="card">
              <h2>Impostazioni Runtime</h2>
              <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Parametri modificabili a runtime senza riavviare il server. Persistiti su disco.</p>
              {Object.entries(settingsByCategory).map(([cat, items]) => (
                <details key={cat} open style={{ marginBottom: 12 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '6px 0', borderBottom: '1px solid var(--line)', marginBottom: 8 }}>
                    {CATEGORY_LABELS[cat] ?? cat} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>({items.length})</span>
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 4 }}>
                    {items.map((s) => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ flex: '0 0 260px' }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{s.key}</div>
                          {s.description && <div className="muted" style={{ fontSize: 11 }}>{s.description}</div>}
                        </div>
                        <div style={{ flex: 1, minWidth: 120 }}>
                          {s.type === 'boolean' ? (
                            <select style={{ width: '100%' }}
                              value={settingDraft[s.key] ?? String(Boolean(s.value))}
                              onChange={(e) => setSettingDraft((prev) => ({ ...prev, [s.key]: e.target.value }))}>
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : s.type === 'secret' ? (
                            <input type="password" style={{ width: '100%' }} placeholder="••••••"
                              value={settingDraft[s.key] ?? ''}
                              onChange={(e) => setSettingDraft((prev) => ({ ...prev, [s.key]: e.target.value }))} />
                          ) : (
                            <input style={{ width: '100%' }}
                              value={settingDraft[s.key] ?? (Array.isArray(s.value) ? (s.value as string[]).join(', ') : String(s.value ?? ''))}
                              onChange={(e) => setSettingDraft((prev) => ({ ...prev, [s.key]: e.target.value }))} />
                          )}
                        </div>
                        <span className="muted" style={{ fontSize: 11, minWidth: 36 }}>{s.source}</span>
                        <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() =>
                            void runAction(`setting.${s.key}`, async () => {
                              let value: unknown = settingDraft[s.key] ?? s.value;
                              if (s.type === 'boolean') value = String(value) === 'true';
                              if (s.type === 'number') value = Number(value);
                              if (s.type === 'string[]') value = csvToList(String(value ?? ''));
                              await apiFetch(`/api/admin/settings/${encodeURIComponent(s.key)}`, {
                                method: 'PATCH',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ value, persist: true }),
                              });
                            })
                          }
                          disabled={busy}>Salva</button>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </section>
          </>
          );
        })()}

        {page === 'characters' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Character Studio</h2>
              <label>Character</label>
              <select value={selectedCharacterKey} onChange={(e) => setSelectedCharacterKey(e.target.value)}>
                {characters.map((c) => <option key={c.key} value={c.key}>{c.key} · {c.modelTier}</option>)}
              </select>
              {characterDraft && (
                <>
                  <label>Name</label>
                  <input value={characterDraft.name} onChange={(e) => setCharacterDraft({ ...characterDraft, name: e.target.value })} />
                  <label>Role</label>
                  <input value={characterDraft.role} onChange={(e) => setCharacterDraft({ ...characterDraft, role: e.target.value })} />
                  <label>Model tier</label>
                  <select value={characterDraft.modelTier} onChange={(e) => setCharacterDraft({ ...characterDraft, modelTier: e.target.value as Character['modelTier'] })}>
                    <option value="small">small</option>
                    <option value="medium">medium</option>
                    <option value="large">large</option>
                  </select>
                  <label>Goals (csv)</label>
                  <input value={characterDraft.goals.join(', ')} onChange={(e) => setCharacterDraft({ ...characterDraft, goals: csvToList(e.target.value) })} />
                  <label>Limits (csv)</label>
                  <input value={characterDraft.limits.join(', ')} onChange={(e) => setCharacterDraft({ ...characterDraft, limits: csvToList(e.target.value) })} />
                  <label>Channels (csv)</label>
                  <input value={characterDraft.channels.join(', ')} onChange={(e) => setCharacterDraft({ ...characterDraft, channels: csvToList(e.target.value) })} />
                  <label>API sources (csv)</label>
                  <input value={characterDraft.apiSources.join(', ')} onChange={(e) => setCharacterDraft({ ...characterDraft, apiSources: csvToList(e.target.value) })} />
                  <label>System instructions</label>
                  <textarea rows={5} value={characterDraft.systemInstructions} onChange={(e) => setCharacterDraft({ ...characterDraft, systemInstructions: e.target.value })} />
                  <div className="btnRow">
                    <button
                      onClick={() =>
                        void runAction(`character.save.${characterDraft.key}`, async () => {
                          await apiFetch(`/api/admin/characters/${characterDraft.key}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ ...characterDraft, persist: true }),
                          });
                        })
                      }
                      disabled={busy}
                    >
                      Save character
                    </button>
                    <button
                      className="ghost"
                      onClick={() =>
                        void runAction(`character.preview.${characterDraft.key}`, async () => {
                          const res = await apiFetch(`/api/admin/characters/${characterDraft.key}/eliza-preview`);
                          setCharacterPreview(await res.json());
                        })
                      }
                      disabled={busy}
                    >
                      Preview Eliza format
                    </button>
                  </div>
                </>
              )}
            </article>
            <article className="card">
              <h3>Character preview</h3>
              <details open>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Formato Eliza-like generato</summary>
                <pre>{JSON.stringify(characterPreview ?? {}, null, 2)}</pre>
              </details>
            </article>
          </section>
        )}

        {page === 'content' && (
          <section className="grid twoCols">
            <article className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>Content Cards</h2>
              <p className="lede">Schede contenuto generate dalla pipeline fattura/RSS. Approva o rifiuta ogni card prima della pubblicazione.</p>
              <div className="btnRow" style={{ marginBottom: 12 }}>
                {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
                  <button
                    key={f}
                    className={contentCardFilter === f ? '' : 'ghost'}
                    onClick={() => {
                      setContentCardFilter(f);
                      void runAction(`cards.load.${f}`, () => refreshContentCards(f === 'all' ? undefined : f));
                    }}
                    disabled={busy}
                  >
                    {f}
                  </button>
                ))}
                <button className="ghost" style={{ marginLeft: 'auto' }} onClick={() => void runAction('cards.refresh', () => refreshContentCards(contentCardFilter === 'all' ? undefined : contentCardFilter))} disabled={busy}>Aggiorna</button>
              </div>

              {contentCards.length === 0 && (
                <p className="muted">Nessuna content card. Importa una fattura Danea (Ingest / Stock) o attendi il worker RSS.</p>
              )}

              <div style={{ display: 'grid', gap: 12 }}>
                {contentCards.map((c) => {
                  const isSelected = selectedCardId === c.id;
                  const statusColor = c.approvalStatus === 'approved' ? '#22c55e' : c.approvalStatus === 'rejected' ? '#ef4444' : '#f59e0b';
                  return (
                    <div key={c.id} className="card" style={{ borderLeft: `4px solid ${statusColor}`, cursor: 'pointer' }} onClick={() => setSelectedCardId(isSelected ? null : c.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ background: statusColor, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{c.approvalStatus}</span>
                        <strong>{c.title}</strong>
                        {c.publishedTo && c.publishedTo.length > 0 && (
                          <span style={{ display: 'inline-flex', gap: 4 }}>
                            {c.publishedTo.includes('telegram') && (
                              <span style={{ background: '#229ED9', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>Telegram ✓</span>
                            )}
                            {c.publishedTo.includes('wordpress') && (
                              <span style={{ background: '#21759B', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>WP ✓</span>
                            )}
                          </span>
                        )}
                        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                          {c.source} · {c.createdAt.slice(0, 10)}
                          {c.publishedAt && ` · Pub: ${new Date(c.publishedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                        </span>
                      </div>
                      <p style={{ marginTop: 6, marginBottom: 0 }}>{c.hook}</p>

                      {isSelected && (
                        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                          {c.telegramDraft && (
                            <div style={{ marginBottom: 8 }}>
                              <strong>Telegram</strong>
                              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>{c.telegramDraft}</pre>
                            </div>
                          )}
                          {c.facebookDraft && (
                            <div style={{ marginBottom: 8 }}>
                              <strong>Facebook</strong>
                              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>{c.facebookDraft}</pre>
                            </div>
                          )}
                          {c.instagramDraft && (
                            <div style={{ marginBottom: 8 }}>
                              <strong>Instagram</strong>
                              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--surface-alt)', padding: 8, borderRadius: 6 }}>{c.instagramDraft}</pre>
                            </div>
                          )}
                          {c.blogDraft && (
                            <div style={{ marginBottom: 8 }}>
                              <strong>Blog draft (HTML)</strong>
                              {/* eslint-disable-next-line react/no-danger */}
                              <div style={{ fontSize: 13, background: 'var(--surface-alt)', padding: 10, borderRadius: 6, maxHeight: 220, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: c.blogDraft }} />
                            </div>
                          )}
                          {c.approvalStatus === 'pending' && (
                            <div className="btnRow" style={{ marginTop: 10 }}>
                              <button onClick={(e) => { e.stopPropagation(); void runAction(`card.approve.${c.id}`, () => approveCard(c.id, 'approve')); }} disabled={busy}>Approva</button>
                              <button className="ghost" style={{ color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); void runAction(`card.reject.${c.id}`, () => approveCard(c.id, 'reject')); }} disabled={busy}>Rifiuta</button>
                            </div>
                          )}
                          {c.approvalStatus !== 'pending' && (
                            <p className="muted" style={{ fontSize: 12 }}>{c.approvalStatus === 'approved' ? 'Approvata' : 'Rifiutata'} da {c.approvedBy ?? '?'} il {c.approvedAt?.slice(0, 10)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="card">
              <h2>WordPress Plugin</h2>
              <p>Scarica il plugin WordPress CopilotRM. Una volta installato e attivato, registra automaticamente il sito e abilita la pubblicazione di articoli dall&apos;agente redattore.</p>
              <p className="muted" style={{ fontSize: 12 }}>Il plugin chiama <code>/api/integrations/wordpress/register</code> all&apos;attivazione e crea un endpoint REST sicuro <code>/wp-json/copilotrm/v1/articles</code>.</p>
              <div className="btnRow">
                <a
                  href={`${API}/api/download/wordpress-plugin`}
                  download="copilotrm-wp-plugin.zip"
                  className="button"
                  style={{ display: 'inline-block', padding: '8px 16px', background: 'var(--accent)', color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}
                >
                  Scarica Plugin WordPress (.zip)
                </a>
              </div>
            </article>
          </section>
        )}

        {page === 'infra' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Infra status</h2>
              <details open>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Stato infrastruttura dettagliato</summary>
                <pre>{JSON.stringify(infra ?? {}, null, 2)}</pre>
              </details>
            </article>
            <article className="card">
              <h2>Infra actions</h2>
              <div className="btnRow">
                <button onClick={() => void runAction('db.migrate', async () => { await apiFetch('/api/system/db/migrate', { method: 'POST' }); })} disabled={busy}>DB migrate</button>
                <button className="ghost" onClick={() => void runAction('db.sync-runtime', async () => { await apiFetch('/api/system/db/sync-runtime', { method: 'POST' }); })} disabled={busy}>Sync runtime→DB</button>
                <button className="ghost" onClick={() => void runAction('db.load-runtime', async () => { await apiFetch('/api/system/db/load-runtime', { method: 'POST' }); })} disabled={busy}>Load DB→runtime</button>
                <button className="ghost" onClick={() => void runAction('queue.enqueue-test', async () => { await apiFetch('/api/system/queue/enqueue-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queue: 'orchestrator-events' }) }); })} disabled={busy}>Enqueue test</button>
              </div>
            </article>
          </section>
        )}
      </section>
    </main>
    <FooterBar
      text="CopilotRM Manager · obiettivi, approvazioni e stato orchestrazione in un’unica sala di regia."
      links={[
        { href: 'http://localhost:4010/health', label: 'Health', external: true },
        { href: 'http://localhost:4010/api/system/infra', label: 'Infra', external: true },
      ]}
    />
    </>
  );
}

export default App;
