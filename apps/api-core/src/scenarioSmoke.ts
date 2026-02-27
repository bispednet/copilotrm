import { buildState } from './server';
import { scenarioFactory } from './scenarioFactory';

const state = buildState();
const scenarios = {
  repairNotWorth: scenarioFactory.repairNotWorth,
  gamerLag: scenarioFactory.gamerLag,
  hardwareInvoice: scenarioFactory.hardwareInvoice,
  smartphonePromo: scenarioFactory.smartphonePromo,
  complaintEmail: scenarioFactory.complaintEmail,
} as const;

for (const [name, factory] of Object.entries(scenarios)) {
  const event = factory();
  const customer = event.customerId ? state.customers.getById(event.customerId) : undefined;
  const out = state.orchestrator.run({
    event,
    customer,
    activeObjectives: state.objectives.listActive(),
    activeOffers: state.offers.listActive(),
    now: new Date().toISOString(),
  });
  console.log(JSON.stringify({
    scenario: name,
    topAction: out.rankedActions[0]?.title ?? null,
    actions: out.rankedActions.length,
    tasks: out.tasks.length,
    drafts: out.drafts.length,
  }));
}
