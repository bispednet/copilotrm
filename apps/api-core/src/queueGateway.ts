import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { logger } from '@bisp/shared-logger';
import type { CommunicationDraft } from '@bisp/shared-types';

export type QueueMode = 'inline' | 'redis';

export class QueueGateway {
  private connection?: IORedis;
  private queues = new Map<string, Queue>();

  constructor(
    private readonly mode: QueueMode,
    private readonly redisUrl: string
  ) {}

  getMode(): QueueMode {
    return this.mode;
  }

  private getQueue(name: string): Queue {
    if (this.mode !== 'redis') throw new Error('QueueGateway is not in redis mode');
    if (!this.connection) {
      this.connection = new IORedis(this.redisUrl, { maxRetriesPerRequest: null });
    }
    const existing = this.queues.get(name);
    if (existing) return existing;
    const q = new Queue(name, { connection: this.connection });
    this.queues.set(name, q);
    return q;
  }

  async enqueueOrchestrator(event: unknown): Promise<{ mode: QueueMode; queue?: string; jobId?: string }> {
    if (this.mode !== 'redis') return { mode: this.mode };
    const job = await this.getQueue('orchestrator-events').add('api.orchestrator.event', event, { removeOnComplete: 1000, removeOnFail: 1000 });
    return { mode: this.mode, queue: 'orchestrator-events', jobId: String(job.id) };
  }

  async enqueueContent(payload: unknown): Promise<{ mode: QueueMode; queue?: string; jobId?: string }> {
    if (this.mode !== 'redis') return { mode: this.mode };
    const job = await this.getQueue('content-jobs').add('api.content.generate', payload, { removeOnComplete: 1000, removeOnFail: 1000 });
    return { mode: this.mode, queue: 'content-jobs', jobId: String(job.id) };
  }

  async enqueueSocial(draft: CommunicationDraft): Promise<{ mode: QueueMode; queue?: string; jobId?: string }> {
    if (this.mode !== 'redis') return { mode: this.mode };
    const job = await this.getQueue('social-publish').add('api.social.publish', draft, { removeOnComplete: 1000, removeOnFail: 1000 });
    return { mode: this.mode, queue: 'social-publish', jobId: String(job.id) };
  }

  async enqueueMedia(payload: unknown): Promise<{ mode: QueueMode; queue?: string; jobId?: string }> {
    if (this.mode !== 'redis') return { mode: this.mode };
    const job = await this.getQueue('media-jobs').add('api.media.generate', payload, { removeOnComplete: 1000, removeOnFail: 1000 });
    return { mode: this.mode, queue: 'media-jobs', jobId: String(job.id) };
  }

  async snapshot(): Promise<{ mode: QueueMode; redisUrl?: string; queues: Record<string, { waiting?: number; active?: number; delayed?: number; failed?: number }> }> {
    if (this.mode !== 'redis') return { mode: this.mode, queues: {} };
    const names = ['orchestrator-events', 'content-jobs', 'social-publish', 'media-jobs'];
    const out: Record<string, { waiting?: number; active?: number; delayed?: number; failed?: number }> = {};
    for (const name of names) {
      try {
        const q = this.getQueue(name);
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
        out[name] = counts;
      } catch (error) {
        logger.warn('queue snapshot failed', { queue: name, error: error instanceof Error ? error.message : String(error) });
        out[name] = {};
      }
    }
    return { mode: this.mode, redisUrl: this.redisUrl, queues: out };
  }

  async close(): Promise<void> {
    for (const q of this.queues.values()) {
      await q.close();
    }
    this.queues.clear();
    if (this.connection) {
      await this.connection.quit();
      this.connection = undefined;
    }
  }
}
