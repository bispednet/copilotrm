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

type NlpParsed = {
  customerName?: string;
  phone?: string;
  deviceCategory?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  issueDescription?: string;
  hasWarranty?: boolean;
  estimatedPrice?: number | null;
  signals?: string[];
};

type NlpResult = {
  parsed: NlpParsed;
  provider: string;
  rawText: string;
  error?: string;
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
  customerName?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Toast = { id: number; kind: 'ok' | 'err'; msg: string };

// ── Speech recognition type shim ─────────────────────────────────────────────
declare global {
  interface Window {
    SpeechRecognition?: new() => SpeechRecognition;
    webkitSpeechRecognition?: new() => SpeechRecognition;
  }
}

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

  // NLP Intake state
  const [intakeMode, setIntakeMode] = useState<'nlp' | 'form'>('nlp');
  const [nlpText, setNlpText] = useState('');
  const [nlpResult, setNlpResult] = useState<NlpResult | null>(null);
  const [nlpBusy, setNlpBusy] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Editable parsed fields
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCategory, setEditCategory] = useState('VARIE');
  const [editBrand, setEditBrand] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editSerial, setEditSerial] = useState('');
  const [editIssue, setEditIssue] = useState('');
  const [editWarranty, setEditWarranty] = useState(false);
  const [editPrice, setEditPrice] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSignals, setEditSignals] = useState('');

  // Classic form
  const [phone, setPhone] = useState('3331112222');
  const [deviceType, setDeviceType] = useState('gaming-pc');
  const [issue, setIssue] = useState('lag e ping alto');
  const [signals, setSignals] = useState('gamer,network-issue');
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [lastTicketResult, setLastTicketResult] = useState<{ ticket?: Ticket } | null>(null);

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
    void loadTickets().catch((err) => showToast('err', `Ticket: ${err instanceof Error ? err.message : String(err)}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chat scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatHistory, chatBusy]);

  // ── Populate edit fields when NLP returns ───────────────────────────────────
  const applyNlpParsed = useCallback((p: NlpParsed) => {
    setEditCustomerName(p.customerName ?? '');
    setEditPhone(p.phone ?? '');
    setEditCategory(p.deviceCategory ?? 'VARIE');
    setEditBrand(p.brand ?? '');
    setEditModel(p.model ?? '');
    setEditSerial(p.serialNumber ?? '');
    setEditIssue(p.issueDescription ?? '');
    setEditWarranty(p.hasWarranty ?? false);
    setEditPrice(p.estimatedPrice != null ? String(p.estimatedPrice) : '');
    setEditSignals(p.signals?.join(', ') ?? '');
  }, []);

  // ── NLP Analysis ─────────────────────────────────────────────────────────────
  const runNlp = useCallback(async () => {
    if (!nlpText.trim()) return;
    setNlpBusy(true);
    try {
      const res = await apiFetch('/api/assist/intake-nlp', {
        method: 'POST',
        body: JSON.stringify({ text: nlpText }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as NlpResult;
      setNlpResult(data);
      applyNlpParsed(data.parsed);
      showToast('ok', `Analisi completata (${data.provider})`);
    } catch (err) {
      showToast('err', `NLP: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setNlpBusy(false);
    }
  }, [nlpText, applyNlpParsed, showToast]);

  // ── Speech recognition ───────────────────────────────────────────────────────
  const toggleSTT = useCallback(() => {
    const SpeechRec = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast('err', 'Speech Recognition non supportato in questo browser (usa Chrome/Edge)');
      return;
    }
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const rec = new SpeechRec();
    rec.lang = 'it-IT';
    rec.continuous = true;
    rec.interimResults = true;
    let finalTranscript = nlpText;
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t + ' ';
        else interim += t;
      }
      setNlpText(finalTranscript + interim);
    };
    rec.onerror = () => { setIsListening(false); showToast('err', 'Errore microfono'); };
    rec.onend = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  }, [isListening, nlpText, showToast]);

  // ── Save NLP ticket ──────────────────────────────────────────────────────────
  const saveNlpTicket = useCallback(async () => {
    if (!editPhone.trim() || !editIssue.trim()) {
      showToast('err', 'Telefono e descrizione problema sono obbligatori');
      return;
    }
    await runAction('Crea ticket', async () => {
      const res = await apiFetch('/api/assist/tickets', {
        method: 'POST',
        body: JSON.stringify({
          phone: editPhone,
          deviceType: editCategory,
          issue: editIssue,
          inferredSignals: editSignals.split(',').map((s) => s.trim()).filter(Boolean),
          customerName: editCustomerName || undefined,
          brand: editBrand || undefined,
          model: editModel || undefined,
          serialNumber: editSerial || undefined,
          hasWarranty: editWarranty,
          estimatedPrice: editPrice ? parseFloat(editPrice) : undefined,
          ticketNotes: editNotes || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ticket?: Ticket };
      setLastTicketResult(data);
      await loadTickets();
    });
  }, [editPhone, editIssue, editCategory, editCustomerName, editBrand, editModel, editSerial,
      editWarranty, editPrice, editNotes, editSignals, runAction, loadTickets, showToast]);

  // ── Print scheda ─────────────────────────────────────────────────────────────
  const printScheda = useCallback((ticketId: string) => {
    window.open(`${API}/api/assist/tickets/${ticketId}/scheda`, '_blank');
  }, []);

  // ── Chat ─────────────────────────────────────────────────────────────────────
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
      setChatHistory((prev) => [...prev, { role: 'assistant', content: `Errore: ${err instanceof Error ? err.message : String(err)}` }]);
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

  const categories = ['PC PORTATILE', 'PC FISSO', 'SMARTPHONE', 'TABLET', 'CELLULARE', 'STAMPANTE', 'TELEVISORE', 'CONSOLE', 'VARIE'];

  return (
    <>
      <div className="toastStack">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>

      <div className="shell appShell">
        {/* Sidebar */}
        <aside className="sidebar">
          <p className="eyebrow">CopilotRM</p>
          <h1 style={{ fontSize: 'clamp(20px,2.4vw,28px)', marginBottom: 4 }}>Assist Desk</h1>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>Accettazione NLP & customer care</p>

          <div className="sidebarTitle">Navigazione</div>
          <nav className="menu">
            {navItems.map((item) => (
              <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => setPage(item.key)}>
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
          <button className="ghost" style={{ width: '100%', textAlign: 'center', marginTop: 8 }} onClick={() => void runAction('Refresh', loadTickets)} disabled={busy}>
            ↻ Aggiorna ticket
          </button>
          <div style={{ marginTop: 12, padding: '10px', background: 'rgba(0,0,0,.04)', borderRadius: 10, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="muted">Aperti</span><strong style={{ color: 'var(--warn)' }}>{openTickets.length}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Chiusi</span><strong style={{ color: 'var(--success)' }}>{closedTickets.length}</strong>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="content">

          {/* ── INTAKE ────────────────────────────────────────────── */}
          {page === 'intake' && (
            <>
              {/* Mode switcher */}
              <div className="tabs" style={{ marginBottom: 12 }}>
                <button className={`tab${intakeMode === 'nlp' ? ' active' : ''}`} onClick={() => setIntakeMode('nlp')}>
                  🤖 Dettatura / Linguaggio naturale
                </button>
                <button className={`tab${intakeMode === 'form' ? ' active' : ''}`} onClick={() => setIntakeMode('form')}>
                  📝 Form classico
                </button>
              </div>

              {/* ── NLP MODE ── */}
              {intakeMode === 'nlp' && (
                <section className="grid twoCols">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Step 1: dettatura */}
                    <article className="card">
                      <h2>① Descrivi il caso in linguaggio naturale</h2>
                      <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                        Puoi scrivere o dettare tutto in una volta: nome cliente, telefono, tipo dispositivo, problema.
                        L'AI estrae automaticamente i campi strutturati.
                      </p>
                      <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                        Es: <em>"Marco Bianchi, cellulare 3331234567, ha un Samsung Galaxy S23, schermo rotto nel mezzo, non risponde al tocco"</em>
                      </p>

                      <div style={{ position: 'relative' }}>
                        <textarea
                          rows={5}
                          value={nlpText}
                          onChange={(e) => setNlpText(e.target.value)}
                          placeholder="Scrivi o detta qui..."
                          style={{ paddingRight: 50 }}
                        />
                        <button
                          onClick={toggleSTT}
                          title={isListening ? 'Ferma registrazione' : 'Inizia dettatura (it-IT)'}
                          style={{
                            position: 'absolute', right: 8, bottom: 8,
                            margin: 0, padding: '8px 10px', fontSize: 18,
                            background: isListening ? 'linear-gradient(90deg,#dc2626,#ef4444)' : 'linear-gradient(90deg,#1a3d6b,#2563eb)',
                            borderRadius: 8,
                            boxShadow: isListening ? '0 0 0 3px rgba(220,38,38,.3)' : 'none',
                            animation: isListening ? 'pulse 1.2s infinite' : 'none',
                          }}
                        >
                          {isListening ? '⏹' : '🎤'}
                        </button>
                      </div>
                      {isListening && (
                        <p style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                          ● Registrazione in corso... parla in italiano
                        </p>
                      )}

                      <div className="btnRow">
                        <button onClick={() => void runNlp()} disabled={nlpBusy || !nlpText.trim()}>
                          {nlpBusy ? '⏳ Analisi...' : '🤖 Analizza con AI'}
                        </button>
                        <button className="ghost" onClick={() => { setNlpText(''); setNlpResult(null); }}>
                          Reset
                        </button>
                      </div>

                      {nlpResult && (
                        <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(27,95,209,.06)', borderRadius: 8, fontSize: 12 }}>
                          <strong>Provider:</strong> {nlpResult.provider}
                          {nlpResult.error && <span style={{ color: 'var(--warn)', marginLeft: 8 }}>⚠ {nlpResult.error}</span>}
                        </div>
                      )}
                    </article>

                    {/* Recent tickets */}
                    <article className="card">
                      <h3>Ultimi ticket aperti</h3>
                      <ul className="stacked">
                        {openTickets.slice(-4).reverse().map((t) => (
                          <li key={t.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                              <code style={{ fontSize: 10 }}>{t.id}</code>
                              <button className="ghost" style={{ margin: 0, padding: '2px 8px', fontSize: 11 }} onClick={() => printScheda(t.id)}>
                                🖨️ Scheda
                              </button>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.customerName ?? t.phoneLookup} · {t.deviceType}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.issue.slice(0, 80)}{t.issue.length > 80 ? '…' : ''}</div>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </div>

                  {/* Step 2: review form */}
                  <article className="card">
                    <h2>② Rivedi e salva</h2>
                    {!nlpResult && (
                      <p className="muted" style={{ fontSize: 13 }}>
                        Compila il campo a sinistra e premi "Analizza con AI" per estrarre automaticamente i dati.
                      </p>
                    )}
                    {(nlpResult || true) && (
                      <>
                        <label>Nome e Cognome cliente</label>
                        <input value={editCustomerName} onChange={(e) => setEditCustomerName(e.target.value)} placeholder="Mario Rossi" />
                        <label>Telefono / GSM *</label>
                        <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="3331234567" />
                        <label>Categoria dispositivo</label>
                        <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div className="btnRow" style={{ marginTop: 0 }}>
                          <div style={{ flex: 1 }}>
                            <label>Marca</label>
                            <input value={editBrand} onChange={(e) => setEditBrand(e.target.value)} placeholder="Samsung, Apple..." />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label>Modello</label>
                            <input value={editModel} onChange={(e) => setEditModel(e.target.value)} placeholder="Galaxy S23..." />
                          </div>
                        </div>
                        <label>Nr. Serie / IMEI</label>
                        <input value={editSerial} onChange={(e) => setEditSerial(e.target.value)} placeholder="Opzionale" />
                        <label>Difetto dichiarato *</label>
                        <textarea rows={3} value={editIssue} onChange={(e) => setEditIssue(e.target.value)} placeholder="Descrizione completa del problema..." />
                        <div className="btnRow" style={{ alignItems: 'center', marginTop: 8 }}>
                          <label style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: 400 }}>
                            <input type="checkbox" checked={editWarranty} onChange={(e) => setEditWarranty(e.target.checked)} style={{ width: 'auto', marginTop: 0 }} />
                            In garanzia
                          </label>
                          <div style={{ flex: 1 }}>
                            <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} placeholder="Preventivo € (opz.)" />
                          </div>
                        </div>
                        <label>Tag / Segnali (csv)</label>
                        <input value={editSignals} onChange={(e) => setEditSignals(e.target.value)} placeholder="gamer, network-issue, schermo..." />
                        <label>Note operative</label>
                        <textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Note interne per il laboratorio..." />

                        <div className="btnRow">
                          <button disabled={busy || !editPhone.trim() || !editIssue.trim()} onClick={() => void saveNlpTicket()}>
                            💾 Salva ticket
                          </button>
                          {lastTicketResult?.ticket && (
                            <button className="ghost" onClick={() => printScheda(lastTicketResult!.ticket!.id)}>
                              🖨️ Stampa scheda
                            </button>
                          )}
                        </div>

                        {lastTicketResult?.ticket && (
                          <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(31,157,91,.08)', border: '1px solid rgba(31,157,91,.25)', borderRadius: 8, fontSize: 13 }}>
                            ✅ Ticket <code>{lastTicketResult.ticket.id}</code> creato
                          </div>
                        )}
                      </>
                    )}
                  </article>
                </section>
              )}

              {/* ── FORM CLASSICO ── */}
              {intakeMode === 'form' && (
                <section className="grid twoCols">
                  <article className="card">
                    <h2>Form classico</h2>
                    <label>Telefono cliente</label>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="333..." />
                    <button onClick={() => void runAction('Cerca cliente', async () => {
                      const res = await apiFetch(`/api/assist/customers/lookup?phone=${encodeURIComponent(phone)}`);
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      setLookupAndChat(await res.json() as LookupResponse);
                    })} disabled={busy}>
                      Cerca in cache Danea
                    </button>
                    {lookup && (
                      <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: lookup.found ? 'rgba(31,157,91,.08)' : 'rgba(214,46,46,.06)', border: `1px solid ${lookup.found ? 'rgba(31,157,91,.25)' : 'rgba(214,46,46,.2)'}`, fontSize: 13 }}>
                        {lookup.found ? <><strong>✅ {lookup.customer?.fullName}</strong> — trovato</> : <>⚠️ Non trovato — cliente provvisorio</>}
                      </div>
                    )}
                    <label>Tipo dispositivo</label>
                    <input value={deviceType} onChange={(e) => setDeviceType(e.target.value)} />
                    <label>Problema</label>
                    <input value={issue} onChange={(e) => setIssue(e.target.value)} />
                    <label>Segnali (csv)</label>
                    <input value={signals} onChange={(e) => setSignals(e.target.value)} />
                    <div className="btnRow">
                      <button disabled={busy} onClick={() => void runAction('Crea ticket', async () => {
                        const res = await apiFetch('/api/assist/tickets', {
                          method: 'POST',
                          body: JSON.stringify({ phone, deviceType, issue, inferredSignals: signals.split(',').map((s) => s.trim()).filter(Boolean) }),
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const data = await res.json() as { ticket?: Ticket };
                        setLastTicketResult(data);
                        await loadTickets();
                      })}>Crea ticket</button>
                      {lastTicketResult?.ticket && (
                        <button className="ghost" onClick={() => printScheda(lastTicketResult!.ticket!.id)}>🖨️ Stampa scheda</button>
                      )}
                    </div>
                    {lastTicketResult?.ticket && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(31,157,91,.08)', border: '1px solid rgba(31,157,91,.25)', borderRadius: 8, fontSize: 13 }}>
                        ✅ Ticket <code>{lastTicketResult.ticket.id}</code> creato
                      </div>
                    )}
                  </article>
                  <article className="card">
                    <h2>Ultimi ticket</h2>
                    <ul className="stacked">
                      {tickets.slice(-5).reverse().map((t) => (
                        <li key={t.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
                          <div style={{ display: 'flex', gap: 6, width: '100%', justifyContent: 'space-between' }}>
                            <code style={{ fontSize: 11 }}>{t.id}</code>
                            <span className={`badge ${t.outcome && t.outcome !== 'pending' ? 'done' : 'open'}`}>{t.outcome ?? 'pending'}</span>
                            <button className="ghost" style={{ margin: 0, padding: '2px 8px', fontSize: 11 }} onClick={() => printScheda(t.id)}>🖨️</button>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.phoneLookup} · {t.deviceType}</div>
                        </li>
                      ))}
                    </ul>
                  </article>
                </section>
              )}
            </>
          )}

          {/* ── TICKETS ───────────────────────────────────────────── */}
          {page === 'tickets' && (
            <section className="grid twoCols">
              <article className="card">
                <h2>Aggiorna outcome</h2>
                <label>ID ticket</label>
                <input value={selectedTicketId} onChange={(e) => setSelectedTicketId(e.target.value)} placeholder="ticket_xxx" />
                <button disabled={busy || !selectedTicketId} onClick={() => void runAction('Chiudi ticket', async () => {
                  const res = await apiFetch(`/api/assist/tickets/${selectedTicketId}/outcome`, {
                    method: 'POST',
                    body: JSON.stringify({ outcome: 'not-worth-repairing', diagnosis: 'riparazione superiore al valore', inferredSignals: ['lag'] }),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  setSelectedTicketId('');
                  await loadTickets();
                })}>
                  Chiudi — non conviene riparare
                </button>
              </article>
              <article className="card">
                <h2>Tutti i ticket ({tickets.length})</h2>
                <div className="tableWrap">
                  <table>
                    <thead><tr><th>ID</th><th>Cliente</th><th>Device</th><th>Issue</th><th>Stato</th><th></th></tr></thead>
                    <tbody>
                      {[...tickets].reverse().map((t) => (
                        <tr key={t.id}>
                          <td><code style={{ fontSize: 10 }}>{t.id}</code></td>
                          <td>{t.customerName ?? t.phoneLookup}</td>
                          <td>{t.brand ? `${t.brand} ${t.model ?? ''}`.trim() : t.deviceType}</td>
                          <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.issue}</td>
                          <td><span className={`badge ${t.outcome && t.outcome !== 'pending' ? 'done' : 'open'}`}>{t.outcome ?? 'pending'}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="ghost" style={{ margin: 0, padding: '3px 6px', fontSize: 11 }} onClick={() => setSelectedTicketId(t.id)}>Sel.</button>
                              <button className="ghost" style={{ margin: 0, padding: '3px 6px', fontSize: 11 }} onClick={() => printScheda(t.id)}>🖨️</button>
                            </div>
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
              <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Assistente AI per supporto tecnico-commerciale.</p>
              <label>Contesto cliente (ID opzionale)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input style={{ flex: 1 }} placeholder="es. cust_mario" value={chatCustomerId} onChange={(e) => { setChatCustomerId(e.target.value); setChatCustomerName(''); }} />
                {chatCustomerName && (
                  <div style={{ background: 'rgba(31,157,91,.1)', borderRadius: 8, padding: '6px 10px', fontSize: 13, whiteSpace: 'nowrap' }}>✅ {chatCustomerName}</div>
                )}
              </div>
              <div className="chatBox" ref={chatBoxRef} style={{ marginTop: 12 }}>
                {chatHistory.length === 0 && (
                  <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    <p>👋 Ciao! Sono CopilotRM Assist.</p>
                    <p>Posso aiutarti con ticket, diagnosi tecniche e suggerimenti commerciali.</p>
                  </div>
                )}
                {chatHistory.map((m, i) => <div key={i} className={`chatBubble ${m.role}`}>{m.content}</div>)}
                {chatBusy && <div className="chatBubble assistant typing">CopilotRM sta elaborando…</div>}
              </div>
              <div className="chatInputRow">
                <textarea placeholder="Es: cliente con gaming-pc, lag grave, cosa consigli?" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }} />
                <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>Invia</button>
              </div>
              {chatHistory.length > 0 && (
                <button className="ghost" style={{ marginTop: 4, fontSize: 12, padding: '6px 10px' }} onClick={() => setChatHistory([])}>Nuova conversazione</button>
              )}
            </article>
          )}

        </main>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
