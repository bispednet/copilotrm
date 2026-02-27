import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

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
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Toast = { id: number; kind: 'ok' | 'err'; msg: string };

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
  }, [chatHistory, chatBusy]);

  const sendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatBusy) return;
    setChatInput('');
    setChatHistory((prev) => [...prev, { role: 'user', content: msg }]);
    setChatBusy(true);
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: msg, customerId: chatCustomerId || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { reply: string; provider?: string };
      setChatHistory((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setChatHistory((prev) => [...prev, { role: 'assistant', content: `Errore: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, chatBusy, chatCustomerId]);

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
                    <h3>Script WhatsApp</h3>
                    <pre style={{ fontSize: 11, maxHeight: 160 }}>{JSON.stringify(consultResult.scripts.whatsapp, null, 2)}</pre>
                    {consultResult.ragHints.length > 0 && (
                      <>
                        <h3>RAG hints ({consultResult.ragHints.length})</h3>
                        <ul style={{ fontSize: 12 }}>
                          {consultResult.ragHints.slice(0, 3).map((h) => (
                            <li key={h.docId}>{h.text} <span className="muted">(score: {h.score.toFixed(2)})</span></li>
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
                    <pre style={{ fontSize: 11, maxHeight: 200 }}>{JSON.stringify(campaignPreview, null, 2)}</pre>
                  </>
                )}
                {campaignLaunch && (
                  <>
                    <h3>Launch result</h3>
                    <pre style={{ fontSize: 11, maxHeight: 200 }}>{JSON.stringify(campaignLaunch, null, 2)}</pre>
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
            <article className="card">
              <h2>Chat con CopilotRM</h2>
              <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Parla con l'AI copilot in italiano. Contestualizza con un cliente per risposte più precise.
              </p>

              <label>Contesto cliente (opzionale)</label>
              <select value={chatCustomerId} onChange={(e) => setChatCustomerId(e.target.value)}>
                <option value="">Nessun cliente selezionato</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName} · {c.segments[0]}</option>
                ))}
              </select>

              <div className="chatBox" ref={chatBoxRef} style={{ marginTop: 12 }}>
                {chatHistory.length === 0 && (
                  <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    <p>Ciao! Sono CopilotRM.</p>
                    <p>Chiedimi consigli su clienti, offerte o campagne.</p>
                  </div>
                )}
                {chatHistory.map((m, i) => (
                  <div key={i} className={`chatBubble ${m.role}`}>{m.content}</div>
                ))}
                {chatBusy && (
                  <div className="chatBubble assistant typing">CopilotRM sta scrivendo…</div>
                )}
              </div>

              <div className="chatInputRow">
                <textarea
                  placeholder="Scrivi un messaggio…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
                />
                <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>
                  Invia
                </button>
              </div>
              {chatHistory.length > 0 && (
                <button
                  className="ghost"
                  style={{ marginTop: 4, fontSize: 12, padding: '6px 10px' }}
                  onClick={() => setChatHistory([])}
                >
                  Svuota chat
                </button>
              )}
            </article>
          )}

        </main>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
