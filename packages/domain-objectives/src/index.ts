import type { ManagerObjective } from '@bisp/shared-types';

export class ObjectiveRepository {
  private objectives = new Map<string, ManagerObjective>();

  upsert(objective: ManagerObjective): void {
    this.objectives.set(objective.id, objective);
  }

  getById(id: string): ManagerObjective | undefined {
    return this.objectives.get(id);
  }

  listAll(): ManagerObjective[] {
    return [...this.objectives.values()];
  }

  listActive(at = new Date()): ManagerObjective[] {
    return [...this.objectives.values()].filter((o) => {
      if (!o.active) return false;
      return new Date(o.periodStart) <= at && at <= new Date(o.periodEnd);
    });
  }

  replaceAll(objectives: ManagerObjective[]): void {
    this.objectives.clear();
    objectives.forEach((o) => this.objectives.set(o.id, o));
  }
}
