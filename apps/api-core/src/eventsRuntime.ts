export type EventCycleType =
  | 'ingest.danea'
  | 'ingest.public-offers'
  | 'outbound.dispatch.approved';

export interface EventCycleConfig {
  enabled: boolean;
  intervalSec: number;
  autoFix: boolean;
}

export interface EventRunLog {
  ts: string;
  level: 'info' | 'warn' | 'error';
  step: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface EventRun {
  id: string;
  type: EventCycleType;
  status: 'running' | 'completed' | 'failed';
  triggeredBy: 'manual' | 'scheduler';
  startedAt: string;
  endedAt?: string;
  progress: number;
  summary?: string;
  logs: EventRunLog[];
}

export interface EventRuntimeStreamEvent {
  kind: 'run-updated';
  run: EventRun;
}

export interface EventRunContext {
  run: EventRun;
  log: (level: EventRunLog['level'], step: string, message: string, details?: Record<string, unknown>) => void;
  progress: (value: number) => void;
  summary: (text: string) => void;
}

type EventCycleHandler = (ctx: EventRunContext, cfg: EventCycleConfig) => Promise<void>;

type ScheduleFn = (type: EventCycleType, trigger: 'manual' | 'scheduler') => Promise<EventRun>;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

export class EventRuntime {
  private readonly configs = new Map<EventCycleType, EventCycleConfig>();
  private readonly handlers = new Map<EventCycleType, EventCycleHandler>();
  private readonly timers = new Map<EventCycleType, NodeJS.Timeout>();
  private readonly runs = new Map<string, EventRun>();
  private readonly order: string[] = [];
  private readonly runningTypes = new Set<EventCycleType>();
  private readonly maxRuns: number;
  private readonly makeId: (prefix: string) => string;
  private readonly subscribers = new Map<number, (event: EventRuntimeStreamEvent) => void>();
  private nextSubscriberId = 1;

  constructor(opts: {
    defaults: Record<EventCycleType, EventCycleConfig>;
    handlers: Record<EventCycleType, EventCycleHandler>;
    makeId: (prefix: string) => string;
    maxRuns?: number;
  }) {
    this.maxRuns = opts.maxRuns ?? 200;
    this.makeId = opts.makeId;
    (Object.keys(opts.defaults) as EventCycleType[]).forEach((type) => {
      this.configs.set(type, { ...opts.defaults[type] });
      this.handlers.set(type, opts.handlers[type]);
    });
  }

  listConfigs(): Array<{ type: EventCycleType; config: EventCycleConfig }> {
    return (Array.from(this.configs.entries()) as Array<[EventCycleType, EventCycleConfig]>)
      .map(([type, config]) => ({ type, config: { ...config } }));
  }

  getConfig(type: EventCycleType): EventCycleConfig | undefined {
    const cfg = this.configs.get(type);
    return cfg ? { ...cfg } : undefined;
  }

  updateConfig(type: EventCycleType, patch: Partial<EventCycleConfig>): EventCycleConfig {
    const current = this.configs.get(type);
    if (!current) throw new Error(`Unknown event cycle: ${type}`);
    const next: EventCycleConfig = {
      enabled: patch.enabled ?? current.enabled,
      intervalSec: Math.max(15, Math.min(24 * 60 * 60, Number(patch.intervalSec ?? current.intervalSec) || current.intervalSec)),
      autoFix: patch.autoFix ?? current.autoFix,
    };
    this.configs.set(type, next);
    return { ...next };
  }

  listRuns(filters?: { type?: EventCycleType; limit?: number }): EventRun[] {
    const limit = Math.max(1, Math.min(filters?.limit ?? 50, this.maxRuns));
    const items = this.order
      .map((id) => this.runs.get(id))
      .filter((r): r is EventRun => Boolean(r))
      .filter((r) => (filters?.type ? r.type === filters.type : true))
      .slice(0, limit);
    return items.map((r) => ({ ...r, logs: [...r.logs] }));
  }

  getRun(id: string): EventRun | undefined {
    const run = this.runs.get(id);
    return run ? { ...run, logs: [...run.logs] } : undefined;
  }

  isRunning(type: EventCycleType): boolean {
    return this.runningTypes.has(type);
  }

  subscribe(listener: (event: EventRuntimeStreamEvent) => void): () => void {
    const id = this.nextSubscriberId++;
    this.subscribers.set(id, listener);
    return () => {
      this.subscribers.delete(id);
    };
  }

  private emitRun(run: EventRun): void {
    const snapshot: EventRuntimeStreamEvent = { kind: 'run-updated', run: { ...run, logs: [...run.logs] } };
    this.subscribers.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // best effort broadcast
      }
    });
  }

  async trigger(type: EventCycleType, triggeredBy: 'manual' | 'scheduler'): Promise<EventRun> {
    const handler = this.handlers.get(type);
    const cfg = this.configs.get(type);
    if (!handler || !cfg) throw new Error(`Unknown event cycle: ${type}`);
    if (this.runningTypes.has(type)) {
      throw new Error(`Cycle already running: ${type}`);
    }

    const runId = this.makeId('evrun');
    const run: EventRun = {
      id: runId,
      type,
      status: 'running',
      triggeredBy,
      startedAt: new Date().toISOString(),
      progress: 0,
      logs: [],
    };
    this.runs.set(runId, run);
    this.order.unshift(runId);
    if (this.order.length > this.maxRuns) {
      const tail = this.order.splice(this.maxRuns);
      tail.forEach((id) => this.runs.delete(id));
    }
    this.runningTypes.add(type);
    this.emitRun(run);

    const ctx: EventRunContext = {
      run,
      log: (level, step, message, details) => {
        run.logs.push({
          ts: new Date().toISOString(),
          level,
          step,
          message,
          details,
        });
        this.emitRun(run);
      },
      progress: (value) => {
        run.progress = clampProgress(value);
        this.emitRun(run);
      },
      summary: (text) => {
        run.summary = text;
        this.emitRun(run);
      },
    };

    try {
      await handler(ctx, { ...cfg });
      run.status = 'completed';
      run.progress = 100;
      if (!run.summary) run.summary = 'Ciclo completato';
      ctx.log('info', 'done', run.summary);
    } catch (error) {
      run.status = 'failed';
      run.summary = run.summary ?? 'Ciclo fallito';
      ctx.log('error', 'failed', error instanceof Error ? error.message : String(error));
    } finally {
      run.endedAt = new Date().toISOString();
      this.runningTypes.delete(type);
      this.emitRun(run);
    }

    return { ...run, logs: [...run.logs] };
  }

  reschedule(triggerFn: ScheduleFn): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers.clear();

    (Array.from(this.configs.entries()) as Array<[EventCycleType, EventCycleConfig]>).forEach(([type, cfg]) => {
      if (!cfg.enabled) return;
      const timer = setInterval(() => {
        void triggerFn(type, 'scheduler').catch(() => undefined);
      }, Math.max(15, cfg.intervalSec) * 1000);
      this.timers.set(type, timer);
    });
  }

  shutdown(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers.clear();
  }
}
