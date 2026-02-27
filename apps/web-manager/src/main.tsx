import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? 'http://localhost:4010';

type Role = 'admin' | 'manager' | 'viewer' | 'sales' | 'content' | 'assist';
type Page =
  | 'home'
  | 'datahub'
  | 'assist'
  | 'crm'
  | 'campaigns'
  | 'swarm'
  | 'outbox'
  | 'ceo'
  | 'admin'
  | 'characters'
  | 'infra'
  | 'ingest';

type Customer = { id: string; fullName: string; phone?: string; segments: string[]; interests?: string[] };
type Offer = { id: string; title: string; category: string; targetSegments: string[]; active: boolean };
type Task = { id: string; kind: string; title: string; status: string; priority: number; assigneeRole: string };
type Ticket = { id: string; phoneLookup: string; deviceType: string; issue: string; outcome: string; inferredSignals: string[] };
type Outbox = { id: string; status: string; draft: { channel: string; audience: string; body: string } };
type Objective = { id: string; name: string; active: boolean; periodStart: string; periodEnd: string; preferredOfferIds: string[] };
type AdminSetting = { key: string; category: string; type?: 'string' | 'boolean' | 'number' | 'secret' | 'string[]'; source: string; value: unknown; description?: string };
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
};

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

  const [objectiveName, setObjectiveName] = useState('Nuovo obiettivo commerciale');
  const [objectiveOfferIds, setObjectiveOfferIds] = useState('');

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
    const [c, o, t, tk, ob, kp, obj, st, ch, inf] = await Promise.all([
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

  const nav: Array<{ key: Page; label: string }> = [
    { key: 'home', label: 'Home / KPI' },
    { key: 'datahub', label: 'Data Hub 360' },
    { key: 'assist', label: 'Assist Desk' },
    { key: 'crm', label: 'CRM Consult' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'swarm', label: 'Swarm Studio' },
    { key: 'ingest', label: 'Ingest / Stock' },
    { key: 'outbox', label: 'Outbox / Approvals' },
    { key: 'ceo', label: 'CEO Objectives' },
    { key: 'admin', label: 'Admin Settings' },
    { key: 'characters', label: 'Character Studio' },
    { key: 'infra', label: 'Infra / Queue' },
  ];

  return (
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
      </aside>

      <section className="content">
        {page === 'home' && (
          <>
            <header className="hero card">
              <div>
                <p className="eyebrow">Executive Summary</p>
                <h2>KPI e stato operativo</h2>
                <p className="lede">Questa dashboard e' il riferimento definitivo UI per guidare backend, modelli, agenti e automazioni.</p>
              </div>
            </header>
            <section className="statsGrid">
              <article className="card stat"><span>Obiettivi attivi</span><strong>{kpi?.objectivesActive ?? 0}</strong></article>
              <article className="card stat"><span>Offerte attive</span><strong>{kpi?.offersActive ?? 0}</strong></article>
              <article className="card stat"><span>Ticket aperti</span><strong>{kpi?.ticketsOpen ?? 0}</strong></article>
              <article className="card stat"><span>Pending approval</span><strong>{kpi?.outbox.pendingApprovals ?? 0}</strong></article>
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
              <pre>{JSON.stringify(lookupResult ?? {}, null, 2)}</pre>
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
              <pre>{JSON.stringify(consultResult ?? {}, null, 2)}</pre>
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
              <pre>{JSON.stringify(campaignPreview ?? {}, null, 2)}</pre>
              <h3>Launch</h3>
              <pre>{JSON.stringify(campaignLaunch ?? {}, null, 2)}</pre>
            </article>
          </section>
        )}

        {page === 'swarm' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Swarm Studio</h2>
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
                })} disabled={busy}>Run scenario</button>
                <button className="ghost" onClick={() => void runAction('orchestrate.custom', async () => {
                  const res = await apiFetch('/api/orchestrate', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ event: { id: `evt_${Date.now()}`, type: 'manager.objective.updated', occurredAt: new Date().toISOString(), payload: { note: 'manual orchestrate test' } } }),
                  });
                  setScenarioResult(await res.json());
                })} disabled={busy}>Run custom event</button>
              </div>
            </article>
            <article className="card">
              <h3>Swarm output</h3>
              <pre>{JSON.stringify(scenarioResult ?? {}, null, 2)}</pre>
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
              <pre>{JSON.stringify(ingestResult ?? {}, null, 2)}</pre>
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

        {page === 'ceo' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>CEO Objectives</h2>
              <label>Nome obiettivo</label>
              <input value={objectiveName} onChange={(e) => setObjectiveName(e.target.value)} />
              <label>Preferred offer IDs (csv)</label>
              <input value={objectiveOfferIds} onChange={(e) => setObjectiveOfferIds(e.target.value)} />
              <button
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
                        preferredOfferIds: csvToList(objectiveOfferIds),
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
              <ul>
                {objectives.map((o) => (
                  <li key={o.id}>
                    <strong>{o.name}</strong> · {o.active ? 'active' : 'inactive'}
                  </li>
                ))}
              </ul>
            </article>
          </section>
        )}

        {page === 'admin' && (
          <section className="card">
            <h2>Admin Settings</h2>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Key</th><th>Category</th><th>Value</th><th>Source</th><th>Save</th></tr></thead>
                <tbody>
                  {settings.map((s) => (
                    <tr key={s.key}>
                      <td title={s.description}>{s.key}</td>
                      <td>{s.category}</td>
                      <td>
                        {s.type === 'boolean' ? (
                          <select
                            value={settingDraft[s.key] ?? String(Boolean(s.value))}
                            onChange={(e) => setSettingDraft((prev) => ({ ...prev, [s.key]: e.target.value }))}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input
                            value={settingDraft[s.key] ?? (Array.isArray(s.value) ? s.value.join(', ') : String(s.value ?? ''))}
                            onChange={(e) => setSettingDraft((prev) => ({ ...prev, [s.key]: e.target.value }))}
                          />
                        )}
                      </td>
                      <td>{s.source}</td>
                      <td>
                        <button
                          className="ghost"
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
                          disabled={busy}
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
              <pre>{JSON.stringify(characterPreview ?? {}, null, 2)}</pre>
            </article>
          </section>
        )}

        {page === 'infra' && (
          <section className="grid twoCols">
            <article className="card">
              <h2>Infra status</h2>
              <pre>{JSON.stringify(infra ?? {}, null, 2)}</pre>
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
  );
}

createRoot(document.getElementById('root')!).render(<App />);
