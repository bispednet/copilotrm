import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? 'http://localhost:4010';

type Customer = { id: string; fullName: string; segments: string[]; interests?: string[] };
type Offer = { id: string; title: string; category: string; targetSegments: string[] };

type ConsultResult = {
  topOffer: Offer | null;
  variants: Array<{ tier: string; text: string }>;
  scripts: { whatsapp: Record<string, string>; call: Record<string, string> };
  ragHints: Array<{ docId: string; text: string; score: number }>;
};

function App() {
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('copilotrm_theme_mode');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [customerId, setCustomerId] = useState('cust_mario');
  const [offerId, setOfferId] = useState('');
  const [campaignOfferId, setCampaignOfferId] = useState('');
  const [segment, setSegment] = useState('smartphone-upgrade');
  const [prompt, setPrompt] = useState('Fammi 3 varianti (economica/bilanciata/top) per questo cliente gamer con problemi rete.');
  const [consult, setConsult] = useState<ConsultResult | null>(null);
  const [campaignPreview, setCampaignPreview] = useState<unknown>(null);
  const [campaignLaunch, setCampaignLaunch] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem('copilotrm_theme_mode', themeMode);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = themeMode === 'system' ? (mq.matches ? 'dark' : 'light') : themeMode;
      document.documentElement.setAttribute('data-theme', effective);
    };
    apply();
    const listener = () => apply();
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, [themeMode]);

  async function loadBase(): Promise<void> {
    const [cs, os] = await Promise.all([
      fetch(`${API}/api/customers`).then((r) => r.json()),
      fetch(`${API}/api/offers`).then((r) => r.json()),
    ]);
    setCustomers(cs);
    setOffers(os);
    if (!campaignOfferId && os[0]?.id) setCampaignOfferId(os[0].id);
  }

  useEffect(() => { void loadBase(); }, []);

  async function runConsult(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/consult/proposal`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId, offerId: offerId || undefined, prompt }),
      });
      setConsult(await res.json());
    } finally { setBusy(false); }
  }

  async function runPreview(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/campaigns/preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offerId: campaignOfferId, segment }),
      });
      setCampaignPreview(await res.json());
    } finally { setBusy(false); }
  }

  async function runLaunch(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/campaigns/launch`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offerId: campaignOfferId, segment }),
      });
      setCampaignLaunch(await res.json());
    } finally { setBusy(false); }
  }

  return (
    <main className="shell dashboard">
      <nav className="topNav card">
        <div className="navLinks">
          <a className="pill active" href="http://localhost:5173">CRM Consult</a>
          <a className="pill" href="http://localhost:5174">Assist Desk</a>
          <a className="pill" href="http://localhost:5175">Control Plane</a>
          <a className="pill" href={`${API}/api/manager/kpi`} target="_blank" rel="noreferrer">KPI API</a>
        </div>
        <div className="navTools">
          <label className="inlineLabel">Theme</label>
          <select value={themeMode} onChange={(e) => setThemeMode(e.target.value as 'system' | 'light' | 'dark')}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </nav>
      <header className="hero">
        <div>
          <p className="eyebrow">CopilotRM / Consult</p>
          <h1>Next Best Action, targeting e copilot vendita</h1>
          <p className="lede">Consult agent, preview campagne, launch one-to-one e one-to-many, con obiettivi e policy.</p>
        </div>
        <div className="heroActions">
          <button onClick={() => void loadBase()}>Refresh offers/customers</button>
          <button className="ghost" onClick={() => void fetch(`${API}/api/ingest/danea/sync`, { method: 'POST' }).then(() => loadBase())}>Sync Danea stub</button>
        </div>
      </header>

      <section className="grid twoCols">
        <article className="card">
          <h2>Consult Agent</h2>
          <label>Cliente</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.fullName} · {c.segments.join(', ')}</option>)}
          </select>
          <label>Offerta (opzionale)</label>
          <select value={offerId} onChange={(e) => setOfferId(e.target.value)}>
            <option value="">Auto</option>
            {offers.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <label>Prompt operatore</label>
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <button disabled={busy} onClick={() => void runConsult()}>Genera proposta</button>
          {consult && (
            <div className="stackSection">
              <h3>Top offer</h3>
              <p>{consult.topOffer?.title ?? 'Nessuna offerta coerente'}</p>
              <h3>Varianti</h3>
              <ul>{consult.variants.map((v) => <li key={v.tier}><strong>{v.tier}:</strong> {v.text}</li>)}</ul>
              <h3>Script WhatsApp</h3>
              <pre>{JSON.stringify(consult.scripts.whatsapp, null, 2)}</pre>
              <h3>RAG hints</h3>
              <pre>{JSON.stringify(consult.ragHints, null, 2)}</pre>
            </div>
          )}
        </article>

        <article className="card">
          <h2>Campaign Builder</h2>
          <label>Offerta</label>
          <select value={campaignOfferId} onChange={(e) => setCampaignOfferId(e.target.value)}>
            {offers.map((o) => <option key={o.id} value={o.id}>{o.title} · {o.category}</option>)}
          </select>
          <label>Segmento</label>
          <input value={segment} onChange={(e) => setSegment(e.target.value)} />
          <div className="btnRow">
            <button disabled={busy} onClick={() => void runPreview()}>Preview targeting</button>
            <button className="ghost" disabled={busy} onClick={() => void runLaunch()}>Launch campaign</button>
          </div>
          {campaignPreview && (
            <div className="stackSection">
              <h3>Preview</h3>
              <pre>{JSON.stringify(campaignPreview, null, 2)}</pre>
            </div>
          )}
          {campaignLaunch && (
            <div className="stackSection">
              <h3>Launch result</h3>
              <pre>{JSON.stringify(campaignLaunch, null, 2)}</pre>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
