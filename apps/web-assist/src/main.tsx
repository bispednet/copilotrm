import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? 'http://localhost:4010';

// ── Types ────────────────────────────────────────────────────────────────────

type Page = 'intake' | 'tickets' | 'chat';

type LookupResponse = {
  found: boolean;
  customer: { id: string; fullName: string } | null;
  mode: string;
  rule: string;
};

type Ticket = {
  id: string;
  customerId?: string;
  provisionalCustomer: boolean;
  phoneLookup: string;
  deviceType: string;
  issue: string;
  outcome?: string;
  inferredSignals: string[];
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Toast = { id: number; kind: 'ok' | 'err'; msg: string };

// ── API helper ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  headers.set('x-bisp-role', 'assist');
  if (!headers.has('content-type') && init?.body) headers.set('content-type', 'application/json');
  return fetch(`${API}${path}`, { ...init, headers });
}

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState<Page>('intake');
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>(() => {
    const s = localStorage.getItem('assist_theme');
    return s === 'light' || s === 'dark' ? s : 'system';
  });
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  // Intake
  const [phone, setPhone] = useState('3331112222');
  const [deviceType, setDeviceType] = useState('gaming-pc');
  const [issue, setIssue] = useState('lag e ping alto');
  const [signals, setSignals] = useState('gamer,network-issue');
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [lastTicketResult, setLastTicketResult] = useState<Record<string, unknown> | null>(null);

  // Tickets
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState('');

  // Chat
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatCustomerId, setChatCustomerId] = useState('');
  const [chatCustomerName, setChatCustomerName] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // ── Theme ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('assist_theme', themeMode);
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
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
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

  const loadTickets = useCallback(async () => {
    const res = await apiFetch('/api/assist/tickets');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setTickets(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    void loadTickets().catch((err) =>
      showToast('err', `Ticket: ${err instanceof Error ? err.message : String(err)}`)
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chat scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
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
      const data = await res.json() as { reply: string };
      setChatHistory((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setChatHistory((prev) => [...prev, {
        role: 'assistant',
        content: `Errore di comunicazione: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, chatBusy, chatCustomerId]);

  const setLookupAndChat = (res: LookupResponse) => {
    setLookup(res);
    if (res.found && res.customer) {
      setChatCustomerId(res.customer.id);
      setChatCustomerName(res.customer.fullName);
    }
  };

  const navItems: Array<{ key: Page; label: string; icon: string }> = [
    { key: 'intake', label: 'Accettazione', icon: '📋' },
    { key: 'tickets', label: 'Ticket', icon: '🎫' },
    { key: 'chat', label: 'Chat CopilotRM', icon: '💬' },
  ];

  const openTickets = tickets.filter((t) => !t.outcome || t.outcome === 'pending');
  const closedTickets = tickets.filter((t) => t.outcome && t.outcome !== 'pending');

  return (
    <>
      <div className="toastStack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>

      <div className="shell appShell">
        {/* Sidebar */}
        <aside className="sidebar">
          <p className="eyebrow">CopilotRM</p>
          <h1 style={{ fontSize: 'clamp(20px,2.4vw,28px)', marginBottom: 4 }}>Assist Desk</h1>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>Accettazione rapida & customer care</p>

          <div className="sidebarTitle">Navigazione</div>
          <nav className="menu">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={page === item.key ? 'active' : ''}
                onClick={() => setPage(item.key)}
              >
                {item.icon} {item.label}
                {item.key === 'tickets' && openTickets.length > 0 && (
                  <span style={{ float: 'right', fontSize: 11, background: 'rgba(255,255,255,.25)', borderRadius: 999, padding: '0 6px' }}>
                    {openTickets.length}
                  </span>
                )}
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
            onClick={() => void runAction('Refresh ticket', loadTickets)}
            disabled={busy}
          >
            ↻ Aggiorna ticket
          </button>

          <div style={{ marginTop: 12, padding: '10px', background: 'rgba(0,0,0,.04)', borderRadius: 10, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="muted">Aperti</span>
              <strong style={{ color: 'var(--warn)' }}>{openTickets.length}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Chiusi</span>
              <strong style={{ color: 'var(--success)' }}>{closedTickets.length}</strong>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="content">

          {/* ── INTAKE ────────────────────────────────────────────── */}
          {page === 'intake' && (
            <section className="grid twoCols">
              <article className="card">
                <h2>Accettazione rapida</h2>
                <p className="muted" style={{ fontSize: 13 }}>
                  Cerca il cliente in cache Danea e crea il ticket di assistenza.
                </p>

                <label>Telefono cliente</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="333..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void runAction('Cerca cliente', async () => {
                        const res = await apiFetch(`/api/assist/customers/lookup?phone=${encodeURIComponent(phone)}`);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        setLookupAndChat(await res.json() as LookupResponse);
                      });
                    }
                  }}
                />

                <button
                  onClick={() => void runAction('Cerca cliente', async () => {
                    const res = await apiFetch(`/api/assist/customers/lookup?phone=${encodeURIComponent(phone)}`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    setLookupAndChat(await res.json() as LookupResponse);
                  })}
                  disabled={busy}
                >
                  Cerca in cache Danea
                </button>

                {lookup && (
                  <div style={{
                    marginTop: 10, padding: '10px 12px', borderRadius: 10,
                    background: lookup.found ? 'rgba(31,157,91,.08)' : 'rgba(214,46,46,.06)',
                    border: `1px solid ${lookup.found ? 'rgba(31,157,91,.25)' : 'rgba(214,46,46,.2)'}`,
                    fontSize: 13,
                  }}>
                    {lookup.found
                      ? <><strong>✅ {lookup.customer?.fullName}</strong> — cliente trovato</>
                      : <>⚠️ Non trovato — verrà creato cliente provvisorio</>
                    }
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{lookup.rule}</div>
                  </div>
                )}

                <hr style={{ border: 'none', borderTop: '1px dashed var(--line)', margin: '14px 0 4px' }} />
                <h3 style={{ marginTop: 4 }}>Dettagli intervento</h3>
                <label>Tipo dispositivo</label>
                <input value={deviceType} onChange={(e) => setDeviceType(e.target.value)} placeholder="es. gaming-pc, smartphone..." />
                <label>Problema</label>
                <input value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Descrivi il problema..." />
                <label>Segnali inferiti (csv)</label>
                <input value={signals} onChange={(e) => setSignals(e.target.value)} placeholder="gamer, network-issue..." />

                <div className="btnRow">
                  <button
                    disabled={busy}
                    onClick={() => void runAction('Crea ticket', async () => {
                      const res = await apiFetch('/api/assist/tickets', {
                        method: 'POST',
                        body: JSON.stringify({
                          phone,
                          deviceType,
                          issue,
                          inferredSignals: signals.split(',').map((s) => s.trim()).filter(Boolean),
                        }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      const data = await res.json() as Record<string, unknown>;
                      setLastTicketResult(data);
                      await loadTickets();
                    })}
                  >
                    Crea ticket assistenza
                  </button>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPhone('3331112222');
                      setDeviceType('gaming-pc');
                      setIssue('lag e ping alto');
                      setSignals('gamer,network-issue');
                      setLookup(null);
                      setLastTicketResult(null);
                    }}
                  >
                    Reset
                  </button>
                </div>

                {lastTicketResult && (
                  <div className="stackSection">
                    <h3>Ticket creato</h3>
                    <pre style={{ fontSize: 11 }}>{JSON.stringify(lastTicketResult, null, 2)}</pre>
                  </div>
                )}
              </article>

              <article className="card">
                <h2>Handoff & Note</h2>
                <p className="muted" style={{ fontSize: 13 }}>
                  Dopo la creazione, l'orchestratore valuta azioni commerciali (preventivo, upsell, customer care).
                </p>
                <h3>Ultimi ticket</h3>
                <ul className="stacked">
                  {tickets.slice(-5).reverse().map((t) => (
                    <li key={t.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
                        <code style={{ fontSize: 11 }}>{t.id}</code>
                        <span className={`badge ${t.outcome && t.outcome !== 'pending' ? 'done' : 'open'}`}>
                          {t.outcome ?? 'pending'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.deviceType} · {t.issue}</div>
                    </li>
                  ))}
                </ul>
                <button className="ghost" style={{ marginTop: 12, width: '100%' }} onClick={() => setPage('tickets')}>
                  Tutti i ticket →
                </button>
                {lookup?.found && lookup.customer && (
                  <button className="ghost" style={{ width: '100%' }} onClick={() => setPage('chat')}>
                    💬 Chat su {lookup.customer!.fullName} →
                  </button>
                )}
              </article>
            </section>
          )}

          {/* ── TICKETS ───────────────────────────────────────────── */}
          {page === 'tickets' && (
            <section className="grid twoCols">
              <article className="card">
                <h2>Aggiorna outcome</h2>
                <label>ID ticket</label>
                <input value={selectedTicketId} onChange={(e) => setSelectedTicketId(e.target.value)} placeholder="ticket_xxx" />
                <button
                  disabled={busy || !selectedTicketId}
                  onClick={() => void runAction('Chiudi ticket', async () => {
                    const res = await apiFetch(`/api/assist/tickets/${selectedTicketId}/outcome`, {
                      method: 'POST',
                      body: JSON.stringify({
                        outcome: 'not-worth-repairing',
                        diagnosis: 'riparazione superiore al valore',
                        inferredSignals: ['gamer', 'lag'],
                      }),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    setSelectedTicketId('');
                    await loadTickets();
                  })}
                >
                  Chiudi — non conviene riparare
                </button>
              </article>

              <article className="card">
                <h2>Tutti i ticket ({tickets.length})</h2>
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr><th>ID</th><th>Phone</th><th>Device</th><th>Issue</th><th>Outcome</th><th></th></tr>
                    </thead>
                    <tbody>
                      {[...tickets].reverse().map((t) => (
                        <tr key={t.id}>
                          <td><code style={{ fontSize: 11 }}>{t.id}</code></td>
                          <td>{t.phoneLookup}</td>
                          <td>{t.deviceType}</td>
                          <td>{t.issue}</td>
                          <td>
                            <span className={`badge ${t.outcome && t.outcome !== 'pending' ? 'done' : 'open'}`}>
                              {t.outcome ?? 'pending'}
                            </span>
                          </td>
                          <td>
                            <button className="ghost" style={{ margin: 0, padding: '4px 8px', fontSize: 11 }} onClick={() => setSelectedTicketId(t.id)}>
                              Seleziona
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          {/* ── CHAT ──────────────────────────────────────────────── */}
          {page === 'chat' && (
            <article className="card">
              <h2>Chat con CopilotRM</h2>
              <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Consulta l'AI copilot per supporto tecnico-commerciale. Seleziona un cliente per risposte contestualizzate.
              </p>

              <label>Contesto cliente (ID opzionale)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={{ flex: 1 }}
                  placeholder="es. cust_mario"
                  value={chatCustomerId}
                  onChange={(e) => { setChatCustomerId(e.target.value); setChatCustomerName(''); }}
                />
                {chatCustomerName && (
                  <div style={{ background: 'rgba(31,157,91,.1)', borderRadius: 8, padding: '6px 10px', fontSize: 13, whiteSpace: 'nowrap' }}>
                    ✅ {chatCustomerName}
                  </div>
                )}
              </div>

              <div className="chatBox" ref={chatBoxRef} style={{ marginTop: 12 }}>
                {chatHistory.length === 0 && (
                  <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    <p>👋 Ciao! Sono CopilotRM Assist.</p>
                    <p>Posso aiutarti con ticket, soluzioni tecniche e suggerimenti commerciali.</p>
                  </div>
                )}
                {chatHistory.map((m, i) => (
                  <div key={i} className={`chatBubble ${m.role}`}>{m.content}</div>
                ))}
                {chatBusy && <div className="chatBubble assistant typing">CopilotRM sta elaborando…</div>}
              </div>

              <div className="chatInputRow">
                <textarea
                  placeholder="Es: questo cliente ha un lag severo sul gaming-pc, cosa consigli?"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
                />
                <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>Invia</button>
              </div>
              {chatHistory.length > 0 && (
                <button className="ghost" style={{ marginTop: 4, fontSize: 12, padding: '6px 10px' }} onClick={() => setChatHistory([])}>
                  Nuova conversazione
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
