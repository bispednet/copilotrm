/*
  Adattamento ispirato a Eliza `knowledge.ts` / `ragknowledge.ts`:
  - preprocess testo
  - chunking
  - retrieval astratto provider-agnostic
*/

export interface RAGDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievedChunk {
  docId: string;
  chunkId: string;
  text: string;
  score: number;
}

export interface RAGStore {
  add(doc: RAGDocument): void;
  search(query: string, limit?: number): RetrievedChunk[];
}

export function preprocessKnowledgeText(content: string): string {
  if (!content || typeof content !== 'string') return '';
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`.*?`/g, '')
    .replace(/#{1,6}\s*(.*)/g, '$1')
    .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function splitChunks(text: string, chunkSize = 320, bleed = 32): string[] {
  const clean = preprocessKnowledgeText(text);
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    out.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = Math.max(0, end - bleed);
  }
  return out;
}

export class InMemoryRAGStore implements RAGStore {
  private docs = new Map<string, RAGDocument>();
  private chunks: Array<{ docId: string; chunkId: string; text: string }> = [];

  add(doc: RAGDocument): void {
    this.docs.set(doc.id, doc);
    const chunks = splitChunks(doc.text);
    chunks.forEach((text, i) => {
      this.chunks.push({ docId: doc.id, chunkId: `${doc.id}#${i}`, text });
    });
  }

  search(query: string, limit = 5): RetrievedChunk[] {
    const terms = preprocessKnowledgeText(query).split(' ').filter((t) => t.length > 2);
    return this.chunks
      .map((chunk) => {
        const score = terms.reduce((acc, term) => acc + (chunk.text.includes(term) ? 1 : 0), 0) / Math.max(terms.length, 1);
        return { ...chunk, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/** Structural copy di EmbeddingClient (evita cross-rootDir import da @bisp/integrations-llm) */
interface EmbeddingClientLike {
  embed(text: string): Promise<number[]>;
}

/** RAGStore asincrono con embedding vettoriale */
export interface AsyncRAGStore {
  add(doc: RAGDocument): Promise<void>;
  search(query: string, limit?: number): Promise<RetrievedChunk[]>;
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * RAGStore vettoriale: usa EmbeddingClient per embed di chunk e query.
 * Mantiene InMemoryRAGStore keyword come fallback automatico.
 */
export class VectorRAGStore implements AsyncRAGStore {
  private entries: Array<{ docId: string; chunkId: string; text: string; vector: number[] }> = [];
  private fallback = new InMemoryRAGStore();

  constructor(private readonly embedding: EmbeddingClientLike) {}

  async add(doc: RAGDocument): Promise<void> {
    this.fallback.add(doc);
    const chunks = splitChunks(doc.text);
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      try {
        const vector = await this.embedding.embed(text);
        this.entries.push({ docId: doc.id, chunkId: `${doc.id}#${i}`, text, vector });
      } catch {
        // embedding failed for this chunk — keyword fallback covers it
      }
    }
  }

  async search(query: string, limit = 5): Promise<RetrievedChunk[]> {
    if (this.entries.length === 0) return this.fallback.search(query, limit);
    let queryVec: number[];
    try {
      queryVec = await this.embedding.embed(preprocessKnowledgeText(query));
    } catch {
      return this.fallback.search(query, limit);
    }
    return this.entries
      .map((e) => ({ docId: e.docId, chunkId: e.chunkId, text: e.text, score: cosineSim(queryVec, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
