/**
 * integrations-email — Email via SendGrid HTTP API v3.
 * Zero dipendenze esterne — usa fetch nativo (Node 18+).
 *
 * Env vars:
 *   SENDGRID_API_KEY   → API key SendGrid (SG.xxxxxxx)
 *   EMAIL_FROM         → mittente (es. noreply@example.com)
 *   EMAIL_FROM_NAME    → nome mittente (es. CopilotRM)
 */
import type { CommunicationDraft } from '@bisp/shared-types';

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailAddress | EmailAddress[];
  subject: string;
  /** Testo plain */
  text?: string;
  /** HTML (opzionale, se assente usa text) */
  html?: string;
  replyTo?: EmailAddress;
}

export interface EmailSendResult {
  ok: boolean;
  provider: 'sendgrid' | 'stub';
  messageId?: string;
  error?: string;
}

// ─── SendGrid client ──────────────────────────────────────────────────────────

function getEnv(key: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
}

export class SendGridEmailClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(params: {
    from: EmailAddress;
    to: EmailAddress | EmailAddress[];
    subject: string;
    text?: string;
    html?: string;
    replyTo?: EmailAddress;
  }): Promise<EmailSendResult> {
    const toList = Array.isArray(params.to) ? params.to : [params.to];
    const body = {
      personalizations: [{ to: toList }],
      from: params.from,
      subject: params.subject,
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      content: [
        ...(params.html ? [{ type: 'text/html', value: params.html }] : []),
        ...(params.text ? [{ type: 'text/plain', value: params.text }] : []),
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 202) {
        // SendGrid ritorna 202 Accepted senza body
        const messageId = res.headers.get('x-message-id') ?? undefined;
        return { ok: true, provider: 'sendgrid', messageId };
      }

      const errText = await res.text().catch(() => res.statusText);
      return { ok: false, provider: 'sendgrid', error: `SendGrid ${res.status}: ${errText}` };
    } catch (err) {
      return { ok: false, provider: 'sendgrid', error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Channel adapter ──────────────────────────────────────────────────────────

export class EmailChannelAdapter {
  private readonly sg: SendGridEmailClient | null;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(config?: { apiKey?: string; fromEmail?: string; fromName?: string }) {
    const apiKey = config?.apiKey ?? getEnv('SENDGRID_API_KEY');
    this.sg = apiKey ? new SendGridEmailClient(apiKey) : null;
    this.fromEmail = config?.fromEmail ?? getEnv('EMAIL_FROM') ?? 'noreply@example.com';
    this.fromName = config?.fromName ?? getEnv('EMAIL_FROM_NAME') ?? 'CopilotRM';
  }

  get configured(): boolean {
    return this.sg !== null;
  }

  /**
   * Invia una email diretta.
   * @param to indirizzo destinatario
   * @param subject oggetto
   * @param body testo o HTML del corpo
   */
  async send(to: string | EmailAddress, subject: string, body: string): Promise<EmailSendResult> {
    if (!this.sg) {
      return { ok: false, provider: 'stub', error: 'SENDGRID_API_KEY non configurata' };
    }
    const toAddr: EmailAddress = typeof to === 'string' ? { email: to } : to;
    return this.sg.send({
      from: { email: this.fromEmail, name: this.fromName },
      to: toAddr,
      subject,
      html: body.includes('<') ? body : undefined,
      text: body.includes('<') ? undefined : body,
    });
  }

  /**
   * Invia o accoda un CommunicationDraft via email.
   * Risolve il destinatario da:
   *   1. `toEmail` parametro esplicito
   *   2. `draft.recipientRef` (deve essere un indirizzo email)
   * Se nessun destinatario → queued.
   * Se `draft.needsApproval` → queued senza inviare (attende approvazione).
   */
  async sendOrQueue(
    draft: CommunicationDraft,
    toEmail?: string
  ): Promise<{ status: 'queued' | 'sent' | 'failed'; provider: string; messageId?: string; error?: string }> {
    if (draft.needsApproval) {
      return { status: 'queued', provider: 'stub' };
    }

    const recipient = toEmail ?? draft.recipientRef;
    if (!recipient || !recipient.includes('@')) {
      return { status: 'queued', provider: 'stub' };
    }

    const subject = draft.subject ?? `Offerta speciale per te`;
    const result = await this.send(recipient, subject, draft.body);

    return {
      status: result.ok ? 'sent' : 'failed',
      provider: result.provider,
      messageId: result.messageId,
      error: result.error,
    };
  }
}
