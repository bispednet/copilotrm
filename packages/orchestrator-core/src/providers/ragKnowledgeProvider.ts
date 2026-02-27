import type { AgentProvider, OrchestratorContext } from '@bisp/shared-types';
import type { RetrievedChunk } from '@bisp/integrations-eliza';

/** Structural interface compatibile con RAGStore e AsyncRAGStore */
interface RAGStoreLike {
  search(query: string, limit?: number): RetrievedChunk[] | Promise<RetrievedChunk[]>;
}

export interface RAGKnowledgeProviderData {
  chunks: RetrievedChunk[];
}

/**
 * Provider che esegue una ricerca RAG sul contesto dell'evento corrente
 * e inietta i chunk rilevanti nel contesto arricchito.
 */
export function createRAGKnowledgeProvider(
  store: RAGStoreLike,
  limit = 5
): AgentProvider<RAGKnowledgeProviderData> {
  return {
    name: 'rag-knowledge',
    async provide(ctx: OrchestratorContext): Promise<RAGKnowledgeProviderData> {
      const query = [
        ctx.event.type,
        ctx.customer?.segments.join(' ') ?? '',
        ctx.activeOffers
          .slice(0, 2)
          .map((o) => o.title)
          .join(' '),
      ]
        .filter(Boolean)
        .join(' ');
      try {
        const chunks = await store.search(query, limit);
        return { chunks };
      } catch {
        return { chunks: [] };
      }
    },
  };
}
