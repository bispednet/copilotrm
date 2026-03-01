import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FooterBar, TopHeader } from './components/Chrome';

const API = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? 'http://localhost:4010';

// ── Types ────────────────────────────────────────────────────────────────────

type Page = 'home' | 'customers' | 'offers' | 'consult' | 'campaigns' | 'chat';
type Customer = { id: string; fullName: string; phone?: string; segments: string[]; interests?: string[] };
type Offer = { id: string; title: string; category: string; targetSegments: string[]; active: boolean };
type ConsultResult = {
  topOffer: Offer | null;
  variants: Array<{ tier: string; text: string }>;
  scripts: { whatsapp: Record<string, string>; call: Record<string, string> };
  ragHints: Array<{ docId: string; text: string; score: number }>;
};
type SwarmThreadMsg = {
  agent: string;
  agentRole: string;
  content: string;
  kind: 'brief' | 'analysis' | 'critique' | 'defense' | 'synthesis';
  mentions: string[];
  round: number;
};
type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; swarmThread?: SwarmThreadMsg[]; swarmRunId?: string | null; customerFound?: { id: string; fullName: string; segments: string[] } | null };
type Toast = { id: number; kind: 'ok' | 'err'; msg: string };

// Agent color palette for the swarm thread UI
const AGENT_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  Orchestratore: { bg: '#1e40af22', border: '#3b82f6', icon: '🎯' },
  Assistenza:    { bg: '#065f4622', border: '#10b981', icon: '🔧' },
  Commerciale:   { bg: '#78350f22', border: '#f59e0b', icon: '💼' },
  Hardware:      { bg: '#4c1d9522', border: '#8b5cf6', icon: '🖥️' },
  Telefonia:     { bg: '#1e3a5f22', border: '#6366f1', icon: '📡' },
  Energia:       { bg: '#713f1222', border: '#f97316', icon: '⚡' },
  CustomerCare:  { bg: '#831843'  + '22', border: '#ec4899', icon: '🤝' },
  Critico:       { bg: '#7f1d1d22', border: '#ef4444', icon: '⚡' },
  Moderatore:    { bg: '#14532d22', border: '#22c55e', icon: '🔍' },
};
const DEFAULT_COLOR = { bg: '#1f293722', border: '#94a3b8', icon: '🤖' };

/** Returns an HSL color from red (0) → amber → green (max). max=1 for 0-1 scores, pass the list max for additive scores. */
function scoreColor(score: number, max = 1): string {
  const ratio = Math.min(score / Math.max(max, 0.001), 1);
  const hue = Math.round(ratio * 120); // 0=red 60=amber 120=green
  return `hsl(${hue}, 72%, 44%)`;
}

const KIND_LABEL: Record<SwarmThreadMsg['kind'], string> = {
  brief:     'Brief',
  analysis:  'Analisi',
  critique:  'Critica',
  defense:   'Difesa',
  synthesis: 'Sintesi',
};

// ── API helper ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  headers.set('x-bisp-role', 'admin');
  if (!headers.has('content-type') && init?.body) headers.set('content-type', 'application/json');
  return fetch(`${API}${path}`, { ...init, headers });
}

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState<Page>('home');
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>(() => {
    const s = localStorage.getItem('crm_theme');
    return s === 'light' || s === 'dark' ? s : 'system';
  });
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  // Data
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [campaignOfferTitle, setCampaignOfferTitle] = useState('');
  const [campaignSegment, setCampaignSegment] = useState('smartphone-upgrade');
  const [campaignPreview, setCampaignPreview] = useState<Record<string, unknown> | null>(null);
  const [campaignLaunch, setCampaignLaunch] = useState<Record<string, unknown> | null>(null);
  const [consultCustomerId, setConsultCustomerId] = useState('cust_mario');
  const [consultOfferId, setConsultOfferId] = useState('');
  const [consultPrompt, setConsultPrompt] = useState('Fammi 3 varianti (economica/bilanciata/top) per questo cliente.');
  const [consultResult, setConsultResult] = useState<ConsultResult | null>(null);

  // Chat
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatCustomerId, setChatCustomerId] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  // SSE streaming state
  const [streamingThread, setStreamingThread] = useState<SwarmThreadMsg[]>([]);
  const [typingAgent, setTypingAgent] = useState<{ agent: string; agentRole: string } | null>(null);
  const streamingThreadRef = useRef<SwarmThreadMsg[]>([]);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // ── Theme ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('crm_theme', themeMode);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const e = themeMode === 'system' ? (mq.matches ? 'dark' : 'light') : themeMode;
      document.documentElement.setAttribute('data-theme', e);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themeMode]);

  // ── Toast ───────────────────────────────────────────────────────────────────
  const showToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, kind, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const runAction = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      showToast('ok', `${label} completato`);
    } catch (err) {
      showToast('err', `${label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const refreshBase = useCallback(async () => {
    const [cs, os] = await Promise.all([
      apiFetch('/api/customers').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      apiFetch('/api/offers').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ]);
    const custArr: Customer[] = Array.isArray(cs) ? cs : [];
    const offerArr: Offer[] = Array.isArray(os) ? os : [];
    setCustomers(custArr);
    setOffers(offerArr);
    if (!campaignOfferTitle && offerArr[0]?.title) setCampaignOfferTitle(offerArr[0].title);
  }, [campaignOfferTitle]);

  useEffect(() => {
    void refreshBase().catch((err) => showToast('err', `Caricamento: ${err instanceof Error ? err.message : String(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chat scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatHistory, streamingThread, typingAgent]);

  // ── SSE streaming sendChat ───────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatBusy) return;
    setChatInput('');

    // Indice dove andrà l'assistant message (dopo il user message)
    const assistantIdx = chatHistory.length + 1;

    setChatHistory((prev) => [...prev, { role: 'user', content: msg }]);
    setChatBusy(true);
    streamingThreadRef.current = [];
    setStreamingThread([]);
    setTypingAgent(null);

    const clearStreaming = () => {
      setTypingAgent(null);
      streamingThreadRef.current = [];
      setStreamingThread([]);
    };

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
        body: JSON.stringify({ message: msg, customerId: chatCustomerId || undefined, sessionId: chatSessionId || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(dataLine.slice(6)) as Record<string, unknown>; } catch { continue; }

          if (event.type === 'typing') {
            setTypingAgent({ agent: String(event.agent), agentRole: String(event.agentRole) });

          } else if (event.type === 'message') {
            setTypingAgent(null);
            const m = event.msg as SwarmThreadMsg;
            streamingThreadRef.current = [...streamingThreadRef.current, m];
            setStreamingThread([...streamingThreadRef.current]);

          } else if (event.type === 'done') {
            const finalThread = [...streamingThreadRef.current];
            const sess = String(event.sessionId ?? '');
            if (sess && !chatSessionId) setChatSessionId(sess);

            clearStreaming();
            setChatHistory((prev) => {
              const next = [...prev, {
                role: 'assistant' as const,
                content: String(event.synthesis ?? ''),
                swarmThread: finalThread,
                swarmRunId: (event.swarmRunId as string | null) ?? null,
                customerFound: (event.customer as { id: string; fullName: string; segments: string[] } | null) ?? null,
              }];
              return next;
            });
            // Auto-espandi il thread dell'assistant appena aggiunto
            if (finalThread.length > 0) {
              setExpandedThreads((prev) => new Set([...prev, assistantIdx]));
            }

          } else if (event.type === 'error') {
            throw new Error(String(event.message));
          }
        }
      }
    } catch (err) {
      clearStreaming();
      setChatHistory((prev) => [...prev, { role: 'assistant', content: `Errore: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      clearStreaming();
      setChatBusy(false);
    }
  }, [chatInput, chatBusy, chatCustomerId, chatHistory.length, chatSessionId]);

  // ── Nav ──────────────────────────────────────────────────────────────────────
  const navItems: Array<{ key: Page; label: string; icon: string }> = [
    { key: 'home', label: 'Dashboard', icon: '📊' },
    { key: 'customers', label: 'Clienti', icon: '👥' },
    { key: 'offers', label: 'Offerte', icon: '🏷️' },
    { key: 'consult', label: 'Consult Agent', icon: '🤖' },
    { key: 'campaigns', label: 'Campagne', icon: '📣' },
    { key: 'chat', label: 'Chat CopilotRM', icon: '💬' },
  ];

  return (
    <>
      {/* Toast layer */}
      <div className="toastStack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>

      <TopHeader
        product="CopilotRM"
        area="CRM Workspace"
        links={[
          { href: 'http://localhost:5173', label: 'CRM' },
          { href: 'http://localhost:5174', label: 'Assist' },
          { href: 'http://localhost:5175', label: 'Manager' },
          { href: 'http://localhost:4010/api/system/infra', label: 'API Status', external: true },
          { href: 'https://github.com/bispednet/copilotrm', label: 'Documentazione', external: true },
        ]}
      />

      <div className="shell appShell">
        {/* Sidebar */}
        <aside className="sidebar">
          <p className="eyebrow">CopilotRM</p>
          <h1 style={{ fontSize: 'clamp(20px,2.4vw,28px)', marginBottom: 4 }}>CRM Consult</h1>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>Next best action & campagne</p>

          <div className="sidebarTitle">Navigazione</div>
          <nav className="menu">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={page === item.key ? 'active' : ''}
                onClick={() => setPage(item.key)}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebarTitle">Tema</div>
          <select value={themeMode} onChange={(e) => setThemeMode(e.target.value as typeof themeMode)} style={{ marginBottom: 8 }}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>

          <div className="crossNav">
            <a href="http://localhost:5173">CRM</a>
            <a href="http://localhost:5174">Assist</a>
            <a href="http://localhost:5175">Control</a>
          </div>

          <button
            className="ghost"
            style={{ width: '100%', textAlign: 'center', marginTop: 8 }}
            onClick={() => void runAction('Refresh', refreshBase)}
            disabled={busy}
          >
            ↻ Aggiorna dati
          </button>
        </aside>

        {/* Main content */}
        <main className="content">
          <header className="hero">
            <div>
              <p className="eyebrow">CRM Consult Workspace</p>
              <h2 style={{ marginBottom: 6 }}>
                {page === 'home' && 'Contesto cliente e opportunità prioritarie'}
                {page === 'customers' && 'Vista cliente 360 pronta per l’azione'}
                {page === 'offers' && 'Catalogo offerte attive e segmenti'}
                {page === 'consult' && 'Next Best Action guidata da profilo + obiettivi'}
                {page === 'campaigns' && 'Campagne mirate con anteprima prima del lancio'}
                {page === 'chat' && 'Swarm conversazionale: da domanda a decisione'}
              </h2>
              <p className="lede">
                {page === 'home' && 'Entrata rapida: controlla volumi, poi apri consult o campagne in base alla priorità commerciale del turno.'}
                {page === 'customers' && 'Ogni riga è un punto di partenza: segmenti e interessi aiutano a capire subito cosa proporre.'}
                {page === 'offers' && 'Usa questa vista per verificare coerenza tra categorie, target e stock attivo prima di consult/campaign.'}
                {page === 'consult' && 'Obiettivo: ottenere una proposta credibile, leggibile e pronta da usare in pochi secondi.'}
                {page === 'campaigns' && 'Fai sempre preview targeting: evita campagne dispersive e concentra il budget operativo.'}
                {page === 'chat' && 'La chat rende visibile il ragionamento multi-agente: utile per casi ambigui o ad alto valore.'}
              </p>
            </div>
            <div className="helper" style={{ maxWidth: 360 }}>
              <strong>Focus operativo</strong>
              <p style={{ margin: '6px 0 0' }}>
                {page === 'home' && 'Vai su Consult Agent per una proposta one-to-one, oppure su Campagne per una one-to-many.'}
                {page === 'customers' && 'Scegli un cliente ad alta coerenza segmento/interessi e passa a Consult con un prompt breve e concreto.'}
                {page === 'offers' && 'Se un’offerta non è chiara nel target, correggi prima di usarla in preview o launch.'}
                {page === 'consult' && 'Confronta le 3 varianti (economica/bilanciata/top) e copia lo script più adatto al canale.'}
                {page === 'campaigns' && 'Lancia solo quando il targeting è convincente e i draft sono realmente utilizzabili.'}
                {page === 'chat' && 'Espandi i thread solo quando serve dettaglio tecnico; tieni il riepilogo come vista principale.'}
              </p>
            </div>
          </header>

          {/* ── HOME ──────────────────────────────────────────────── */}
          {page === 'home' && (
            <>
              <header className="hero card" style={{ marginBottom: 14 }}>
                <div>
                  <p className="eyebrow">CopilotRM / CRM Consult</p>
                  <h2 style={{ fontSize: 'clamp(22px,2.5vw,32px)' }}>Next Best Action, targeting, campagne</h2>
                  <p className="lede">Consult agent per offerte personalizzate, campagne one-to-one e one-to-many con obiettivi e policy.</p>
                </div>
              </header>
              <div className="statsGrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <article className="card stat"><span>Clienti totali</span><strong>{customers.length}</strong></article>
                <article className="card stat"><span>Offerte attive</span><strong>{offers.filter((o) => o.active).length}</strong></article>
                <article className="card stat"><span>Tutte le offerte</span><strong>{offers.length}</strong></article>
              </div>
              <section className="grid twoCols" style={{ marginTop: 14 }}>
                <article className="card">
                  <h3>Azioni rapide</h3>
                  <div className="btnRow">
                    <button onClick={() => setPage('consult')} disabled={busy}>Consult Agent →</button>
                    <button className="ghost" onClick={() => setPage('campaigns')} disabled={busy}>Campagne →</button>
                    <button className="ghost" onClick={() => setPage('chat')} disabled={busy}>Chat CopilotRM →</button>
                  </div>
                  <button
                    className="ghost"
                    style={{ marginTop: 10 }}
                    onClick={() => void runAction('Sync Danea', async () => {
                      const r = await apiFetch('/api/ingest/danea/sync', { method: 'POST' });
                      if (!r.ok) throw new Error(`HTTP ${r.status}`);
                      await refreshBase();
                    })}
                    disabled={busy}
                  >
                    Sync Danea stub
                  </button>
                </article>
                <article className="card">
                  <h3>Ultimi clienti</h3>
                  <ul className="stacked">
                    {customers.slice(0, 5).map((c) => (
                      <li key={c.id}>
                        <span><strong>{c.fullName}</strong> <small className="muted">{c.segments.join(', ')}</small></span>
                        <span className="muted" style={{ fontSize: 12 }}>{c.phone ?? '-'}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </section>
            </>
          )}

          {/* ── CUSTOMERS ─────────────────────────────────────────── */}
          {page === 'customers' && (
            <article className="card">
              <h2>Clienti ({customers.length})</h2>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr><th>ID</th><th>Nome</th><th>Telefono</th><th>Segmenti</th><th>Interessi</th></tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td><code>{c.id}</code></td>
                        <td><strong>{c.fullName}</strong></td>
                        <td>{c.phone ?? '—'}</td>
                        <td>{c.segments.join(', ')}</td>
                        <td className="muted">{c.interests?.join(', ') ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}

          {/* ── OFFERS ────────────────────────────────────────────── */}
          {page === 'offers' && (
            <article className="card">
              <h2>Offerte ({offers.length})</h2>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr><th>ID</th><th>Titolo</th><th>Categoria</th><th>Target</th><th>Attiva</th></tr>
                  </thead>
                  <tbody>
                    {offers.map((o) => (
                      <tr key={o.id}>
                        <td><code>{o.id}</code></td>
                        <td><strong>{o.title}</strong></td>
                        <td>{o.category}</td>
                        <td>{o.targetSegments.join(', ')}</td>
                        <td>{o.active ? '✅' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}

          {/* ── CONSULT ───────────────────────────────────────────── */}
          {page === 'consult' && (
            <section className="grid twoCols">
              <article className="card">
                <h2>Consult Agent</h2>
                <div className="infoPanel" style={{ marginBottom: 8 }}>
                  <strong>Obiettivo</strong>
                  <p style={{ margin: '6px 0 0' }}>
                    Genera una proposta subito utilizzabile: scegli cliente, aggiungi prompt breve e confronta le 3 varianti prima di inviare.
                  </p>
                </div>
                <label>Cliente</label>
                <select value={consultCustomerId} onChange={(e) => setConsultCustomerId(e.target.value)}>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.fullName} · {c.segments[0]}</option>
                  ))}
                </select>
                <label>Offerta (opzionale)</label>
                <select value={consultOfferId} onChange={(e) => setConsultOfferId(e.target.value)}>
                  <option value="">Auto — lascia scegliere al sistema</option>
                  {offers.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
                <label>Prompt operatore</label>
                <textarea rows={3} value={consultPrompt} onChange={(e) => setConsultPrompt(e.target.value)} />
                <button
                  disabled={busy}
                  onClick={() => void runAction('Consult Agent', async () => {
                    const res = await apiFetch('/api/consult/proposal', {
                      method: 'POST',
                      body: JSON.stringify({ customerId: consultCustomerId, offerId: consultOfferId || undefined, prompt: consultPrompt }),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    setConsultResult(await res.json() as ConsultResult);
                  })}
                >
                  Genera proposta
                </button>
              </article>

              <article className="card">
                <h2>Risultato proposta</h2>
                {consultResult ? (
                  <div className="stackSection" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                    <h3>Top offer</h3>
                    <p>{consultResult.topOffer?.title ?? 'Nessuna offerta coerente trovata'}</p>
                    <h3>Varianti testo</h3>
                    <ul className="stacked">
                      {consultResult.variants.map((v) => (
                        <li key={v.tier} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                          <strong style={{ textTransform: 'capitalize' }}>{v.tier}</strong>
                          <span style={{ fontSize: 13 }}>{v.text}</span>
                        </li>
                      ))}
                    </ul>
                    <h3>Script</h3>
                    {(['whatsapp', 'call'] as const).map(ch => {
                      const entries = Object.entries(consultResult.scripts[ch] ?? {});
                      if (!entries.length) return null;
                      return (
                        <div key={ch} style={{ marginBottom: 10 }}>
                          <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{ch === 'whatsapp' ? '📱 WhatsApp' : '📞 Chiamata'}</p>
                          {entries.map(([tone, text]) => (
                            <div key={tone} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', marginBottom: 6, position: 'relative' }}>
                              <span style={{ fontSize: 11, textTransform: 'capitalize', fontWeight: 600, color: 'var(--muted)' }}>{tone}</span>
                              <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}>{text}</p>
                              <button className="ghost" style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, padding: '1px 6px' }} onClick={() => void navigator.clipboard.writeText(text)}>Copia</button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    <details style={{ marginTop: 4 }}>
                      <summary className="muted" style={{ cursor: 'pointer', fontSize: 11 }}>JSON grezzo</summary>
                      <pre style={{ fontSize: 10, marginTop: 4, maxHeight: 160 }}>{JSON.stringify(consultResult.scripts, null, 2)}</pre>
                    </details>
                    {consultResult.ragHints.length > 0 && (
                      <>
                        <h3>RAG hints ({consultResult.ragHints.length})</h3>
                        <ul style={{ fontSize: 12 }}>
                          {consultResult.ragHints.slice(0, 3).map((h) => (
                            <li key={h.docId} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                              <span style={{ fontWeight: 700, fontSize: 10, background: scoreColor(h.score), color: '#fff', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>{h.score.toFixed(2)}</span>
                              {h.text}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="muted">Genera una proposta con il pannello a sinistra.</p>
                )}
              </article>
            </section>
          )}

          {/* ── CAMPAIGNS ─────────────────────────────────────────── */}
          {page === 'campaigns' && (
            <section className="grid twoCols">
              <article className="card">
                <h2>Campaign Builder</h2>
                <div className="infoPanel" style={{ marginBottom: 8 }}>
                  <strong>Workflow sicuro</strong>
                  <p style={{ margin: '6px 0 0' }}>
                    Fai sempre <em>Preview targeting</em> prima di <em>Launch campaign</em>. Riduci dispersione e migliora qualita outbox.
                  </p>
                </div>
                <label>Offerta (titolo contiene)</label>
                <input value={campaignOfferTitle} onChange={(e) => setCampaignOfferTitle(e.target.value)} placeholder="es. Oppo, TIM, Fibra..." />
                <label>Segmento</label>
                <input value={campaignSegment} onChange={(e) => setCampaignSegment(e.target.value)} placeholder="es. smartphone-upgrade" />
                <div className="btnRow">
                  <button
                    disabled={busy}
                    onClick={() => void runAction('Campaign Preview', async () => {
                      const res = await apiFetch('/api/campaigns/preview', {
                        method: 'POST',
                        body: JSON.stringify({ offerTitle: campaignOfferTitle, segment: campaignSegment }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      setCampaignPreview(await res.json() as Record<string, unknown>);
                    })}
                  >
                    Preview targeting
                  </button>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => void runAction('Campaign Launch', async () => {
                      const res = await apiFetch('/api/campaigns/launch', {
                        method: 'POST',
                        body: JSON.stringify({ offerTitle: campaignOfferTitle, segment: campaignSegment }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      setCampaignLaunch(await res.json() as Record<string, unknown>);
                    })}
                  >
                    Launch campaign
                  </button>
                </div>
              </article>

              <article className="card">
                {campaignPreview && (
                  <>
                    <h3>Preview targeting</h3>
                    <div style={{ marginBottom: 10 }}>
                      <strong>{(campaignPreview as any).offer?.title ?? '—'}</strong>
                      {(campaignPreview as any).offer?.category && (
                        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{(campaignPreview as any).offer.category}</span>
                      )}
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>· seg. <code style={{ fontSize: 11 }}>{(campaignPreview as any).segment ?? '—'}</code></span>
                    </div>
                    {(() => {
                      const tgt = (campaignPreview as any).targeting as Array<{ customerId: string; fullName: string; score: number; reasons?: string[] }>;
                      const maxScore = tgt?.length ? Math.max(...tgt.map(t => t.score)) : 1;
                      return (
                        <>
                          <p style={{ fontSize: 13, margin: '0 0 4px' }}>👥 <strong>{tgt?.length ?? 0}</strong> clienti nel target</p>
                          <ul className="stacked" style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 8 }}>
                            {tgt?.map(t => (
                              <li key={t.customerId} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{t.fullName}</span>
                                <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
                                  <span style={{ fontWeight: 700, fontSize: 10, background: scoreColor(t.score, maxScore), color: '#fff', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.03em' }}>{t.score.toFixed(1)}</span>
                                  {t.reasons?.join(' · ')}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      );
                    })()}
                    <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 8 }}>
                      <span>📨 1:1: <strong>{((campaignPreview as any).drafts?.oneToOne as unknown[])?.length ?? 0} draft</strong></span>
                      <span>📢 1:N: <strong>{((campaignPreview as any).drafts?.oneToMany as unknown[])?.length ?? 0} draft</strong></span>
                    </div>
                    <details>
                      <summary className="muted" style={{ cursor: 'pointer', fontSize: 11 }}>JSON grezzo</summary>
                      <pre style={{ fontSize: 10, marginTop: 4, maxHeight: 180 }}>{JSON.stringify(campaignPreview, null, 2)}</pre>
                    </details>
                  </>
                )}
                {campaignLaunch && (
                  <>
                    <h3>Launch result</h3>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 13 }}>
                      <span>🎯 <strong>{String((campaignLaunch as any).targetingCount ?? 0)}</strong> clienti</span>
                      <span>📤 <strong>{((campaignLaunch as any).outboxItems as unknown[])?.length ?? 0}</strong> messaggi</span>
                      <span>✅ <strong>{((campaignLaunch as any).tasks as unknown[])?.length ?? 0}</strong> task</span>
                    </div>
                    {(((campaignLaunch as any).tasks as Array<{ id: string; type: string; status: string; assigneeRole?: string }>)?.length > 0) && (
                      <ul className="stacked" style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 8 }}>
                        {((campaignLaunch as any).tasks as Array<{ id: string; type: string; status: string; assigneeRole?: string }>).map(t => (
                          <li key={t.id}>
                            <span style={{ fontSize: 13 }}>{t.type}</span>
                            <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{t.assigneeRole ? `${t.assigneeRole} · ` : ''}{t.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <details>
                      <summary className="muted" style={{ cursor: 'pointer', fontSize: 11 }}>JSON grezzo</summary>
                      <pre style={{ fontSize: 10, marginTop: 4, maxHeight: 180 }}>{JSON.stringify(campaignLaunch, null, 2)}</pre>
                    </details>
                  </>
                )}
                {!campaignPreview && !campaignLaunch && (
                  <p className="muted">Configura e lancia una campagna con il pannello a sinistra.</p>
                )}
              </article>
            </section>
          )}

          {/* ── CHAT ──────────────────────────────────────────────── */}
          {page === 'chat' && (
            <article className="card" style={{ maxWidth: 860, margin: '0 auto' }}>
              <h2>Chat con CopilotRM</h2>
              <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Ogni messaggio avvia una discussione multi-agente. Il team analizza, si sfida, e produce una risposta coordinata.
              </p>
              <div className="infoPanel" style={{ marginBottom: 10 }}>
                <strong>Modalita consigliata</strong>
                <p style={{ margin: '6px 0 0' }}>
                  Leggi prima la sintesi finale. Espandi i thread agenti solo quando vuoi verificare motivazioni, handoff e punti di dissenso.
                </p>
              </div>

              <label>Contesto cliente (opzionale — o scrivi il nome nel messaggio)</label>
              <select value={chatCustomerId} onChange={(e) => setChatCustomerId(e.target.value)} style={{ marginBottom: 12 }}>
                <option value="">Nessun cliente selezionato</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName} · {c.segments[0]}</option>
                ))}
              </select>

              <div className="chatBox" ref={chatBoxRef} style={{ marginTop: 0, minHeight: 320 }}>
                {chatHistory.length === 0 && (
                  <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 20px' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
                    <p style={{ fontWeight: 600 }}>Team CopilotRM pronto.</p>
                    <p>Ogni tua domanda viene analizzata da un team di agenti specialistici:<br />
                      <span style={{ color: '#3b82f6' }}>Orchestratore</span> · <span style={{ color: '#10b981' }}>Assistenza</span> · <span style={{ color: '#f59e0b' }}>Commerciale</span> · <span style={{ color: '#8b5cf6' }}>Hardware</span> · <span style={{ color: '#6366f1' }}>Telefonia</span> · <span style={{ color: '#f97316' }}>Energia</span> · <span style={{ color: '#ec4899' }}>CustomerCare</span> · <span style={{ color: '#ef4444' }}>Critico</span> · <span style={{ color: '#22c55e' }}>Moderatore</span>
                    </p>
                  </div>
                )}

                {chatHistory.map((m, i) => {
                  if (m.role === 'user') {
                    return (
                      <div key={i} className="chatBubble user">{m.content}</div>
                    );
                  }

                  // Assistant message: reply + swarm thread
                  const hasThread = m.role === 'assistant' && (m.swarmThread?.length ?? 0) > 0;
                  const threadOpen = expandedThreads.has(i);

                  return (
                    <div key={i} style={{ marginBottom: 16 }}>
                      {/* Customer found indicator */}
                      {m.role === 'assistant' && m.customerFound && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, paddingLeft: 4 }}>
                          👤 Contesto cliente: <strong>{m.customerFound.fullName}</strong> ({m.customerFound.segments.join(', ')})
                        </div>
                      )}

                      {/* Swarm thread toggle */}
                      {hasThread && (
                        <div
                          style={{ marginBottom: 6, cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => setExpandedThreads((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          })}
                        >
                          <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14 }}>{threadOpen ? '▾' : '▸'}</span>
                            <span>Discussione agenti ({m.role === 'assistant' && m.swarmThread?.length} messaggi)</span>
                            {m.role === 'assistant' && m.swarmRunId && (
                              <code style={{ fontSize: 10 }}>#{m.swarmRunId.slice(-6)}</code>
                            )}
                          </span>
                        </div>
                      )}

                      {/* Swarm thread panel */}
                      {hasThread && threadOpen && m.role === 'assistant' && (
                        <div style={{
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          padding: '12px 14px',
                          marginBottom: 8,
                          background: 'var(--surface-alt)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}>
                          {m.swarmThread!.map((tm, ti) => {
                            const col = AGENT_COLORS[tm.agent] ?? DEFAULT_COLOR;
                            // Highlight @mentions in content
                            const contentWithMentions = tm.content.replace(
                              /@([A-Za-z]+)/g,
                              '<span style="color:#f59e0b;font-weight:700">@$1</span>'
                            );
                            return (
                              <div key={ti} style={{
                                background: col.bg,
                                border: `1.5px solid ${col.border}`,
                                borderRadius: 8,
                                padding: '8px 12px',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 16 }}>{col.icon}</span>
                                  <span style={{ fontWeight: 700, fontSize: 13, color: col.border }}>{tm.agent}</span>
                                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tm.agentRole}</span>
                                  <span style={{ marginLeft: 'auto', fontSize: 10, background: col.border + '33', color: col.border, borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
                                    {KIND_LABEL[tm.kind]}
                                  </span>
                                </div>
                                {/* eslint-disable-next-line react/no-danger */}
                                <div style={{ fontSize: 13, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: contentWithMentions }} />
                                {tm.mentions.length > 0 && (
                                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
                                    → {tm.mentions.map((mn) => `@${mn}`).join(' ')}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Final reply bubble */}
                      <div className="chatBubble assistant" style={{
                        borderLeft: '3px solid #22c55e',
                        paddingLeft: 12,
                      }}>
                        {m.content}
                      </div>
                    </div>
                  );
                })}

                {/* Live streaming thread: appare durante chatBusy, scompare dopo done */}
                {chatBusy && (streamingThread.length > 0 || typingAgent) && (
                  <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '12px 14px',
                    marginBottom: 8,
                    background: 'var(--surface-alt)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}>
                    {streamingThread.map((tm, ti) => {
                      const col = AGENT_COLORS[tm.agent] ?? DEFAULT_COLOR;
                      const contentWithMentions = tm.content.replace(
                        /@([A-Za-zÀ-ù]+)/g,
                        '<span style="color:#f59e0b;font-weight:700">@$1</span>'
                      );
                      return (
                        <div key={ti} style={{ background: col.bg, border: `1.5px solid ${col.border}`, borderRadius: 8, padding: '8px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 16 }}>{col.icon}</span>
                            <span style={{ fontWeight: 700, fontSize: 13, color: col.border }}>{tm.agent}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tm.agentRole}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 10, background: col.border + '33', color: col.border, borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
                              {KIND_LABEL[tm.kind]}
                            </span>
                          </div>
                          {/* eslint-disable-next-line react/no-danger */}
                          <div style={{ fontSize: 13, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: contentWithMentions }} />
                          {tm.mentions.length > 0 && (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
                              → {tm.mentions.map((mn) => `@${mn}`).join(' ')}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Typing indicator: mostra l'agente corrente */}
                    {typingAgent && (() => {
                      const col = AGENT_COLORS[typingAgent.agent] ?? DEFAULT_COLOR;
                      return (
                        <div style={{ background: col.bg, border: `1.5px dashed ${col.border}`, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, opacity: 0.85 }}>
                          <span style={{ fontSize: 16 }}>{col.icon}</span>
                          <span style={{ fontWeight: 700, fontSize: 13, color: col.border }}>{typingAgent.agent}</span>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{typingAgent.agentRole}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>sta scrivendo…</span>
                          <span style={{ display: 'inline-flex', gap: 3 }}>
                            {[0, 1, 2].map((d) => (
                              <span key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: col.border, animation: `pulse 1.2s ${d * 0.2}s infinite` }} />
                            ))}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div className="chatInputRow" style={{ marginTop: 8 }}>
                <textarea
                  placeholder="Scrivi un messaggio… (Es: 'Mario Rossi vuole giocare a Fortnite, cosa proponiamo?')"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
                  rows={2}
                />
                <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>
                  Invia
                </button>
              </div>

              {chatHistory.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {chatSessionId && (
                    <code style={{ fontSize: 10, color: 'var(--muted)', padding: '2px 6px', background: 'var(--surface-alt)', borderRadius: 4 }}>
                      sessione: {chatSessionId.slice(-8)}
                    </code>
                  )}
                  <button
                    className="ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => { setChatHistory([]); setExpandedThreads(new Set()); setChatSessionId(null); }}
                  >
                    Nuova sessione
                  </button>
                  <button
                    className="ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => {
                      const allIdx = chatHistory.reduce((acc, m, i) => {
                        if (m.role === 'assistant' && (m as Extract<ChatMessage, {role:'assistant'}>).swarmThread?.length) acc.push(i);
                        return acc;
                      }, [] as number[]);
                      const allOpen = allIdx.every((i) => expandedThreads.has(i));
                      setExpandedThreads(allOpen ? new Set() : new Set(allIdx));
                    }}
                  >
                    {chatHistory.some((m, i) => m.role === 'assistant' && (m as Extract<ChatMessage, {role:'assistant'}>).swarmThread?.length && !expandedThreads.has(i))
                      ? 'Espandi tutti i thread'
                      : 'Comprimi tutti i thread'}
                  </button>
                </div>
              )}
            </article>
          )}

        </main>
      </div>

      <FooterBar
        text="CopilotRM CRM · consult, campagne e thread swarm con orientamento next best action."
        links={[
          { href: 'http://localhost:4010/health', label: 'Health', external: true },
          { href: 'http://localhost:4010/api/offers', label: 'Offers API', external: true },
        ]}
      />
    </>
  );
}

export default App;
