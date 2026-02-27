import React from 'react';
import { startTransition, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? 'http://localhost:4010';

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

function App() {
  const [phone, setPhone] = useState('3331112222');
  const [deviceType, setDeviceType] = useState('gaming-pc');
  const [issue, setIssue] = useState('lag e ping alto');
  const [signals, setSignals] = useState('gamer,network-issue');
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<unknown>(null);

  async function loadTickets(): Promise<void> {
    const res = await fetch(`${API}/api/assist/tickets`);
    const data = await res.json();
    setTickets(data);
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  async function doLookup(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/assist/customers/lookup?phone=${encodeURIComponent(phone)}`);
      setLookup(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function createTicket(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/assist/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone,
          deviceType,
          issue,
          inferredSignals: signals.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      await res.json();
      await loadTickets();
    } finally {
      setBusy(false);
    }
  }

  async function closeAsNotWorth(ticketId: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/assist/tickets/${ticketId}/outcome`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outcome: 'not-worth-repairing',
          diagnosis: 'riparazione superiore al valore',
          inferredSignals: ['gamer', 'lag'],
        }),
      });
      const json = await res.json();
      startTransition(() => setLastOutcome(json));
      await loadTickets();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell assist">
      <header>
        <p className="eyebrow">CopilotRM Assist Desk</p>
        <h1>Accettazione rapida e anti-duplicato</h1>
      </header>
      <section className="card">
        <label>Telefono cliente</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="333..." />
        <button onClick={() => void doLookup()} disabled={busy}>Cerca in cache Danea</button>
        {lookup && (
          <p className="muted">
            {lookup.found ? `Trovato: ${lookup.customer?.fullName}` : 'Non trovato (cliente provvisorio interno)'} | {lookup.rule}
          </p>
        )}
        <label>Dispositivo</label>
        <input value={deviceType} onChange={(e) => setDeviceType(e.target.value)} />
        <label>Problema</label>
        <input value={issue} onChange={(e) => setIssue(e.target.value)} />
        <label>Segnali (csv)</label>
        <input value={signals} onChange={(e) => setSignals(e.target.value)} />
        <button onClick={() => void createTicket()} disabled={busy}>Crea ticket assistenza</button>
        <p className="muted">Se non trovato: crea cliente provvisorio interno (non master).</p>
      </section>
      <section className="grid">
        <article className="card">
          <h2>Ticket</h2>
          <p>Workflow tecnico, esito, trigger commerciali.</p>
          <ul>
            {tickets.slice(-5).reverse().map((t) => (
              <li key={t.id}>
                <strong>{t.id}</strong> · {t.deviceType} · {t.outcome ?? 'pending'}
                {t.outcome === 'pending' && (
                  <button style={{ marginLeft: 8 }} onClick={() => void closeAsNotWorth(t.id)} disabled={busy}>
                    Esito: non conviene
                  </button>
                )}
              </li>
            ))}
          </ul>
        </article>
        <article className="card">
          <h2>Handoff</h2>
          <p>Assistenza → Preventivi / Telephony / Customer Care.</p>
          <p className="muted">
            {lastOutcome ? `Ultimo top action: ${(lastOutcome as { orchestrator?: { rankedActions?: Array<{ title: string }> } })?.orchestrator?.rankedActions?.[0]?.title ?? 'n/d'}` : 'Nessun handoff eseguito in questa sessione UI'}
          </p>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
