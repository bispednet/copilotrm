/**
 * agent-bus — in-memory pub/sub event bus + AgentDiscussion roundtable.
 * Ispirato al sistema multi-agent di Eliza (rooms + message routing).
 */

// ─── Event Bus ────────────────────────────────────────────────────────────────

export type BusEventHandler<T = unknown> = (payload: T) => void | Promise<void>;

/**
 * Bus pub/sub in-memory per comunicazione inter-agente.
 * Può essere esteso in futuro con Redis Streams per deployment distribuito.
 */
export class AgentBus {
  private handlers = new Map<string, BusEventHandler[]>();

  on<T = unknown>(event: string, handler: BusEventHandler<T>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as BusEventHandler);
    this.handlers.set(event, list);
  }

  off<T = unknown>(event: string, handler: BusEventHandler<T>): void {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter((h) => h !== handler));
  }

  async emit<T = unknown>(event: string, payload: T): Promise<void> {
    const list = this.handlers.get(event) ?? [];
    await Promise.all(list.map((h) => Promise.resolve(h(payload))));
  }

  /** Lista degli eventi registrati */
  registeredEvents(): string[] {
    return [...this.handlers.keys()];
  }
}

// ─── Discussion Roundtable ────────────────────────────────────────────────────

export interface DiscussionAgent {
  name: string;
  role: string;
  /** System prompt aggiuntivo per la persona dell'agente */
  persona?: string;
}

export interface DiscussionMessage {
  agent: string;
  content: string;
  round: number;
}

export interface DiscussionResult {
  topic: string;
  messages: DiscussionMessage[];
  synthesis?: string;
  durationMs: number;
}

/** Structural copy di LLMClient (evita cross-rootDir import da @bisp/integrations-llm) */
interface LLMClientLike {
  chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: { tier?: 'small' | 'medium' | 'large'; maxTokens?: number }
  ): Promise<{ content: string }>;
}

/**
 * AgentDiscussion — roundtable multi-agente LLM.
 * Ogni agente partecipa alla discussione leggendo gli interventi precedenti.
 * Alla fine un moderatore sintetizza i punti chiave.
 */
export class AgentDiscussion {
  constructor(private readonly llm: LLMClientLike) {}

  async discuss(params: {
    topic: string;
    context?: string;
    agents: DiscussionAgent[];
    rounds?: number;
    maxWordsPerTurn?: number;
  }): Promise<DiscussionResult> {
    const { topic, context = '', agents, rounds = 2, maxWordsPerTurn = 80 } = params;
    const start = Date.now();
    const messages: DiscussionMessage[] = [];

    for (let r = 0; r < rounds; r++) {
      for (const agent of agents) {
        const history = messages.map((m) => `**${m.agent}**: ${m.content}`).join('\n');
        const systemPrompt = [
          `Sei ${agent.name}, ${agent.role}.`,
          agent.persona ?? '',
          'Rispondi in italiano. Sii conciso e diretto.',
        ]
          .filter(Boolean)
          .join(' ');

        const userPrompt = [
          `Argomento della discussione: ${topic}`,
          context ? `Contesto: ${context}` : '',
          history ? `Interventi precedenti:\n${history}` : '',
          `Esprimi la tua prospettiva (max ${maxWordsPerTurn} parole). Considera gli interventi precedenti se presenti.`,
        ]
          .filter(Boolean)
          .join('\n\n');

        try {
          const resp = await this.llm.chat(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            { tier: 'small', maxTokens: 200 }
          );
          messages.push({ agent: agent.name, content: resp.content.trim(), round: r + 1 });
        } catch {
          messages.push({ agent: agent.name, content: `[${agent.name} non disponibile]`, round: r + 1 });
        }
      }
    }

    // Sintesi finale del moderatore
    let synthesis: string | undefined;
    if (messages.some((m) => !m.content.startsWith('['))) {
      const transcript = messages.map((m) => `${m.agent}: ${m.content}`).join('\n');
      try {
        const synthResp = await this.llm.chat(
          [
            {
              role: 'system',
              content:
                'Sei un moderatore neutrale. Sintetizza la discussione in 2-3 frasi concise, identificando i punti di accordo e le divergenze principali.',
            },
            {
              role: 'user',
              content: `Argomento: ${topic}\n\nDiscussione:\n${transcript}\n\nSintetizza i punti chiave.`,
            },
          ],
          { tier: 'small', maxTokens: 250 }
        );
        synthesis = synthResp.content.trim();
      } catch {
        // sintesi non disponibile
      }
    }

    return { topic, messages, synthesis, durationMs: Date.now() - start };
  }
}

/** Singleton bus di default — condiviso tra moduli dell'app */
export const defaultBus = new AgentBus();
