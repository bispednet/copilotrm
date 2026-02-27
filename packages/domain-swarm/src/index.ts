import type { SwarmHandoff, SwarmMessage, SwarmRun, SwarmStep } from '@bisp/shared-types';

export type { SwarmHandoff, SwarmMessage, SwarmRun, SwarmStep };
export type { SwarmStatus, SwarmMessageKind } from '@bisp/shared-types';

export class SwarmRuntime {
  private runs = new Map<string, SwarmRun>();
  private steps = new Map<string, SwarmStep[]>();
  private messages = new Map<string, SwarmMessage[]>();
  private handoffs = new Map<string, SwarmHandoff[]>();

  // ── Runs ─────────────────────────────────────────────────────────────────

  createRun(run: SwarmRun): SwarmRun {
    this.runs.set(run.id, run);
    return run;
  }

  updateRun(id: string, patch: Partial<SwarmRun>): void {
    const run = this.runs.get(id);
    if (run) this.runs.set(id, { ...run, ...patch });
  }

  getRun(id: string): SwarmRun | undefined {
    return this.runs.get(id);
  }

  listRuns(limit = 50): SwarmRun[] {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  addStep(step: SwarmStep): SwarmStep {
    const list = this.steps.get(step.runId) ?? [];
    list.push(step);
    this.steps.set(step.runId, list);
    return step;
  }

  updateStep(id: string, runId: string, patch: Partial<SwarmStep>): void {
    const list = this.steps.get(runId) ?? [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx >= 0) list[idx] = { ...list[idx]!, ...patch };
  }

  listSteps(runId: string): SwarmStep[] {
    return this.steps.get(runId) ?? [];
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  addMessage(msg: SwarmMessage): SwarmMessage {
    const list = this.messages.get(msg.runId) ?? [];
    list.push(msg);
    this.messages.set(msg.runId, list);
    return msg;
  }

  listMessages(runId: string): SwarmMessage[] {
    return this.messages.get(runId) ?? [];
  }

  // ── Handoffs ──────────────────────────────────────────────────────────────

  addHandoff(handoff: SwarmHandoff): SwarmHandoff {
    const list = this.handoffs.get(handoff.runId) ?? [];
    list.push(handoff);
    this.handoffs.set(handoff.runId, list);
    return handoff;
  }

  updateHandoff(id: string, runId: string, patch: Partial<SwarmHandoff>): void {
    const list = this.handoffs.get(runId) ?? [];
    const idx = list.findIndex((h) => h.id === id);
    if (idx >= 0) list[idx] = { ...list[idx]!, ...patch };
  }

  listHandoffs(runId: string): SwarmHandoff[] {
    return this.handoffs.get(runId) ?? [];
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  snapshot(runId: string): {
    run: SwarmRun | undefined;
    steps: SwarmStep[];
    messages: SwarmMessage[];
    handoffs: SwarmHandoff[];
  } {
    return {
      run: this.getRun(runId),
      steps: this.listSteps(runId),
      messages: this.listMessages(runId),
      handoffs: this.listHandoffs(runId),
    };
  }
}
