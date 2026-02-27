/**
 * integrations-whatsapp — WhatsApp Business Cloud API (Meta Graph API).
 * Zero dipendenze esterne — usa fetch nativo (Node 18+).
 *
 * Env vars:
 *   WHATSAPP_API_TOKEN         → token permanente (System User) o temporaneo
 *   WHATSAPP_PHONE_NUMBER_ID   → ID numero di telefono business (da Meta for Developers)
 *   WHATSAPP_API_VERSION       → versione API (default: v19.0)
 */
import type { CommunicationDraft } from '@bisp/shared-types';

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface WhatsAppSendResult {
  ok: boolean;
  status: 'queued' | 'sent' | 'failed';
  provider: 'meta' | 'stub';
  messageId?: string;
  error?: string;
}

export interface WhatsAppTextMessage {
  to: string;        // numero in formato E.164 es. +39335123456 o 39335123456
  text: string;
  previewUrl?: boolean;
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{ type: 'text' | 'currency' | 'date_time'; text?: string }>;
  }>;
}

// ─── WhatsApp Cloud API client ────────────────────────────────────────────────

function getEnv(key: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
}

export class WhatsAppCloudClient {
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;

  constructor(config: { token: string; phoneNumberId: string; apiVersion?: string }) {
    this.token = config.token;
    this.phoneNumberId = config.phoneNumberId;
    this.apiVersion = config.apiVersion ?? 'v19.0';
  }

  private get apiUrl(): string {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  private normalizePhone(phone: string): string {
    // Rimuove spazi, trattini, parentesi; assicura che inizi con il prefisso paese
    return phone.replace(/[\s\-().+]/g, '');
  }

  /** Invia un messaggio di testo libero */
  async sendText(params: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhone(params.to),
      type: 'text',
      text: {
        preview_url: params.previewUrl ?? false,
        body: params.text,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        messages?: Array<{ id: string }>;
        error?: { message: string; code: number };
      };

      if (!res.ok || data.error) {
        const msg = data.error?.message ?? `HTTP ${res.status}`;
        return { ok: false, status: 'failed', provider: 'meta', error: `WhatsApp API: ${msg}` };
      }
      return {
        ok: true,
        status: 'sent',
        provider: 'meta',
        messageId: data.messages?.[0]?.id,
      };
    } catch (err) {
      return {
        ok: false,
        status: 'failed',
        provider: 'meta',
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Invia un messaggio tramite template pre-approvato Meta */
  async sendTemplate(params: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    const body = {
      messaging_product: 'whatsapp',
      to: this.normalizePhone(params.to),
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.languageCode ?? 'it' },
        components: params.components ?? [],
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        messages?: Array<{ id: string }>;
        error?: { message: string; code: number };
      };
      if (!res.ok || data.error) {
        return { ok: false, status: 'failed', provider: 'meta', error: `WhatsApp template: ${data.error?.message ?? res.status}` };
      }
      return { ok: true, status: 'sent', provider: 'meta', messageId: data.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, status: 'failed', provider: 'meta', error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Channel adapter ──────────────────────────────────────────────────────────

export class WhatsAppChannelAdapter {
  private readonly wa: WhatsAppCloudClient | null;

  constructor(config?: { token?: string; phoneNumberId?: string; apiVersion?: string }) {
    const token = config?.token ?? getEnv('WHATSAPP_API_TOKEN');
    const phoneNumberId = config?.phoneNumberId ?? getEnv('WHATSAPP_PHONE_NUMBER_ID');
    this.wa = token && phoneNumberId
      ? new WhatsAppCloudClient({ token, phoneNumberId, apiVersion: config?.apiVersion ?? getEnv('WHATSAPP_API_VERSION') })
      : null;
  }

  get configured(): boolean {
    return this.wa !== null;
  }

  /**
   * Invia o accoda un CommunicationDraft via WhatsApp.
   * Risolve il numero di telefono da:
   *   1. `toPhone` parametro esplicito
   *   2. `draft.recipientRef` (numero E.164)
   * Se `draft.needsApproval` → queued senza inviare.
   * Se il client non è configurato → queued:stub.
   */
  async sendOrQueue(
    draft: CommunicationDraft,
    toPhone?: string
  ): Promise<WhatsAppSendResult> {
    if (draft.needsApproval) {
      return { ok: true, status: 'queued', provider: 'stub', messageId: `wa_${draft.id}` };
    }

    const phone = toPhone ?? draft.recipientRef;
    if (!phone || !this.wa) {
      return { ok: true, status: 'queued', provider: 'stub', messageId: `wa_${draft.id}` };
    }

    return this.wa.sendText({ to: phone, text: draft.body });
  }
}
