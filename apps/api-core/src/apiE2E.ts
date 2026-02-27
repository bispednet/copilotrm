import assert from 'node:assert/strict';
import { buildServer } from './server';

async function main(): Promise<void> {
  const app = buildServer();
  const adminHeaders = { 'x-bisp-role': 'admin' };

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);

  const datahubOverview = await app.inject({ method: 'GET', url: '/api/datahub/overview' });
  assert.equal(datahubOverview.statusCode, 200);
  assert.equal(typeof datahubOverview.json().customers, 'number');

  const lookup = await app.inject({ method: 'GET', url: '/api/assist/customers/lookup?phone=3331112222' });
  assert.equal(lookup.statusCode, 200);
  const lookupJson = lookup.json();
  assert.equal(lookupJson.found, true);
  assert.equal(lookupJson.customer.id, 'cust_mario');

  const ticketCreate = await app.inject({
    method: 'POST',
    url: '/api/assist/tickets',
    payload: {
      phone: '3331112222',
      deviceType: 'gaming-pc',
      issue: 'lag e ping alto',
      inferredSignals: ['gamer', 'network-issue'],
    },
  });
  assert.equal(ticketCreate.statusCode, 201);
  const ticketJson = ticketCreate.json();
  assert.ok(ticketJson.ticket.id);

  const outcome = await app.inject({
    method: 'POST',
    url: `/api/assist/tickets/${ticketJson.ticket.id}/outcome`,
    payload: {
      outcome: 'not-worth-repairing',
      diagnosis: 'riparazione superiore al valore',
      inferredSignals: ['gamer', 'lag'],
    },
  });
  assert.equal(outcome.statusCode, 200);
  const outcomeJson = outcome.json();
  assert.equal(outcomeJson.orchestrator.rankedActions[0].agent, 'telephony');
  assert.ok(outcomeJson.orchestrator.tasks.length >= 1);

  const daneaSync = await app.inject({ method: 'POST', url: '/api/ingest/danea/sync' });
  assert.equal(daneaSync.statusCode, 200);
  assert.ok(daneaSync.json().synced >= 1);

  const promo = await app.inject({
    method: 'POST',
    url: '/api/ingest/promo',
    payload: {
      title: 'Oppo 13 Max + smartwatch omaggio',
      category: 'smartphone',
      conditions: 'fino a fine mese',
      stockQty: 20,
      targetSegments: ['smartphone-upgrade', 'famiglia'],
    },
  });
  assert.equal(promo.statusCode, 201);
  const promoJson = promo.json();
  const offerId = promoJson.offer.id as string;

  const preview = await app.inject({
    method: 'POST',
    url: '/api/campaigns/preview',
    payload: { offerId, segment: 'smartphone-upgrade' },
  });
  assert.equal(preview.statusCode, 200);
  const previewJson = preview.json();
  assert.ok(previewJson.targeting.length >= 1);
  assert.ok(previewJson.drafts.oneToMany.length >= 1);

  const launch = await app.inject({
    method: 'POST',
    url: '/api/campaigns/launch',
    headers: adminHeaders,
    payload: { offerId, segment: 'smartphone-upgrade' },
  });
  assert.equal(launch.statusCode, 201);
  const launchJson = launch.json();
  assert.ok(launchJson.campaign.id);
  assert.ok(launchJson.outboxItems.length >= 1);

  const pendingOutbox = await app.inject({ method: 'GET', url: '/api/outbox?status=pending-approval', headers: adminHeaders });
  assert.equal(pendingOutbox.statusCode, 200);
  const pendingItems = pendingOutbox.json();
  assert.ok(pendingItems.length >= 1);

  const approve = await app.inject({
    method: 'POST',
    url: `/api/outbox/${pendingItems[0].id}/approve`,
    headers: adminHeaders,
    payload: { actor: 'manager-test' },
  });
  assert.equal(approve.statusCode, 200);

  const send = await app.inject({ method: 'POST', url: `/api/outbox/${pendingItems[0].id}/send`, headers: adminHeaders });
  assert.equal(send.statusCode, 200);

  const consult = await app.inject({
    method: 'POST',
    url: '/api/consult/proposal',
    headers: adminHeaders,
    payload: { customerId: 'cust_mario', prompt: 'fammi una proposta gaming rete' },
  });
  assert.equal(consult.statusCode, 200);
  const consultJson = consult.json();
  assert.ok(Array.isArray(consultJson.variants));
  assert.ok(Array.isArray(consultJson.ragHints));

  const datahubCustomer = await app.inject({ method: 'GET', url: '/api/datahub/customers/cust_mario' });
  assert.equal(datahubCustomer.statusCode, 200);
  assert.equal(datahubCustomer.json().customer.id, 'cust_mario');

  const datahubSearch = await app.inject({ method: 'GET', url: '/api/datahub/search?q=oppo' });
  assert.equal(datahubSearch.statusCode, 200);
  assert.ok(Array.isArray(datahubSearch.json().offers));

  const inboundEmail = await app.inject({
    method: 'POST',
    url: '/api/inbound/message',
    headers: adminHeaders,
    payload: {
      channel: 'email',
      from: 'cliente@example.com',
      subject: 'Reclamo consegna',
      body: 'Sono deluso dalla consegna, come risolviamo?',
      customerId: 'cust_mario',
    },
  });
  assert.equal(inboundEmail.statusCode, 201);
  const inboundEmailJson = inboundEmail.json();
  assert.ok(inboundEmailJson.event.id);
  assert.ok(Array.isArray(inboundEmailJson.orchestrator.rankedActions));

  const inboundWhatsapp = await app.inject({
    method: 'POST',
    url: '/api/inbound/message',
    headers: adminHeaders,
    payload: {
      channel: 'whatsapp',
      from: '+393331112222',
      body: 'Il wifi continua ad andare male la sera',
      phone: '3331112222',
    },
  });
  assert.equal(inboundWhatsapp.statusCode, 201);
  assert.ok(inboundWhatsapp.json().event.id);

  const callLog = await app.inject({
    method: 'POST',
    url: '/api/inbound/calls/log',
    headers: adminHeaders,
    payload: {
      phone: '3331112222',
      disposition: 'callback-request',
      notes: 'Richiesta richiamata domani mattina per proposta fibra',
    },
  });
  assert.equal(callLog.statusCode, 201);
  assert.ok(callLog.json().orchestrator);

  const kpi = await app.inject({ method: 'GET', url: '/api/manager/kpi', headers: adminHeaders });
  assert.equal(kpi.statusCode, 200);
  const kpiJson = kpi.json();
  assert.ok(kpiJson.tasks.total >= 1);
  assert.ok(kpiJson.outbox.total >= 1);

  const objectiveCreate = await app.inject({
    method: 'POST',
    url: '/api/manager/objectives',
    headers: adminHeaders,
    payload: {
      id: 'obj_test_e2e',
      name: 'E2E objective test',
      active: true,
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      preferredOfferIds: [offerId],
    },
  });
  assert.equal(objectiveCreate.statusCode, 201);

  const objectiveActivate = await app.inject({
    method: 'POST',
    url: '/api/manager/objectives/obj_test_e2e/activate',
    headers: adminHeaders,
    payload: { active: false },
  });
  assert.equal(objectiveActivate.statusCode, 200);
  assert.equal(objectiveActivate.json().active, false);

  const objectiveScorecard = await app.inject({ method: 'GET', url: '/api/manager/objectives/scorecard' });
  assert.equal(objectiveScorecard.statusCode, 200);
  assert.ok(Array.isArray(objectiveScorecard.json()));

  const settings = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: adminHeaders });
  assert.equal(settings.statusCode, 200);
  const settingsJson = settings.json();
  assert.ok(Array.isArray(settingsJson.items));
  assert.ok(settingsJson.items.some((i: { key: string }) => i.key === 'models.provider.large'));

  const characters = await app.inject({ method: 'GET', url: '/api/admin/characters', headers: adminHeaders });
  assert.equal(characters.statusCode, 200);
  const charactersJson = characters.json();
  assert.ok(Array.isArray(charactersJson));
  assert.ok(charactersJson.length >= 1);

  const firstCharacterKey = String(charactersJson[0].key);
  const characterPatch = await app.inject({
    method: 'PATCH',
    url: `/api/admin/characters/${firstCharacterKey}`,
    headers: adminHeaders,
    payload: { systemInstructions: 'Priorita: compliance e upsell etico.', persist: false },
  });
  assert.equal(characterPatch.statusCode, 200);

  const characterPreview = await app.inject({ method: 'GET', url: `/api/admin/characters/${firstCharacterKey}/eliza-preview`, headers: adminHeaders });
  assert.equal(characterPreview.statusCode, 200);
  assert.ok(typeof characterPreview.json().system === 'string');

  const swarmCapabilities = await app.inject({ method: 'GET', url: '/api/swarm/capabilities' });
  assert.equal(swarmCapabilities.statusCode, 200);
  assert.ok(Array.isArray(swarmCapabilities.json().agents));
  assert.ok(swarmCapabilities.json().agents.some((a: { id: string }) => a.id === 'energy'));
  assert.ok(swarmCapabilities.json().agents.some((a: { id: string }) => a.id === 'hardware'));

  const adminIntegrations = await app.inject({ method: 'GET', url: '/api/admin/integrations', headers: adminHeaders });
  assert.equal(adminIntegrations.statusCode, 200);
  assert.equal(adminIntegrations.json().adapters.whatsapp.enabled, true);
  assert.equal(adminIntegrations.json().adapters.media.enabled, true);

  const mediaGenerate = await app.inject({
    method: 'POST',
    url: '/api/media/generate',
    headers: adminHeaders,
    payload: {
      kind: 'avatar-video',
      title: 'Promo Oppo bundle',
      brief: 'Video breve verticale per campagna smartphone-upgrade',
      channel: 'instagram',
    },
  });
  assert.equal(mediaGenerate.statusCode, 201);
  assert.ok(Array.isArray(mediaGenerate.json().result.assets));

  const mediaJobs = await app.inject({ method: 'GET', url: '/api/media/jobs', headers: adminHeaders });
  assert.equal(mediaJobs.statusCode, 200);
  assert.ok(Array.isArray(mediaJobs.json()));

  const channelDispatches = await app.inject({ method: 'GET', url: '/api/channels/dispatches', headers: adminHeaders });
  assert.equal(channelDispatches.statusCode, 200);
  assert.ok(Array.isArray(channelDispatches.json()));

  const swarmSimulate = await app.inject({
    method: 'POST',
    url: '/api/swarm/simulate',
    payload: {
      eventType: 'manager.objective.updated',
      payload: { note: 'e2e simulate' },
    },
  });
  assert.equal(swarmSimulate.statusCode, 201);
  assert.ok(Array.isArray(swarmSimulate.json().output.rankedActions));

  const swarmRuns = await app.inject({ method: 'GET', url: '/api/swarm/runs' });
  assert.equal(swarmRuns.statusCode, 200);
  assert.ok(Array.isArray(swarmRuns.json()));

  const infra = await app.inject({ method: 'GET', url: '/api/system/infra', headers: adminHeaders });
  assert.equal(infra.statusCode, 200);
  const infraJson = infra.json();
  assert.equal(typeof infraJson.redis.configured, 'boolean');
  assert.ok(['memory', 'postgres', 'hybrid'].includes(String(infraJson.persistenceMode)));

  const dbSnapshot = await app.inject({ method: 'GET', url: '/api/system/db/snapshot', headers: adminHeaders });
  assert.equal(dbSnapshot.statusCode, 200);
  assert.equal(typeof dbSnapshot.json().counts, 'object');

  const dbSyncRuntime = await app.inject({ method: 'POST', url: '/api/system/db/sync-runtime', headers: adminHeaders });
  assert.equal(dbSyncRuntime.statusCode, 200);
  assert.equal(dbSyncRuntime.json().ok, true);

  const dbLoadRuntime = await app.inject({ method: 'POST', url: '/api/system/db/load-runtime', headers: adminHeaders });
  assert.equal(dbLoadRuntime.statusCode, 200);
  assert.equal(dbLoadRuntime.json().ok, true);

  const queueTest = await app.inject({ method: 'POST', url: '/api/system/queue/enqueue-test', headers: adminHeaders, payload: { queue: 'orchestrator-events' } });
  assert.equal(queueTest.statusCode, 200);
  assert.ok(['inline', 'redis'].includes(queueTest.json().mode));

  const ingestHistory = await app.inject({ method: 'GET', url: '/api/ingest/history' });
  assert.equal(ingestHistory.statusCode, 200);
  assert.ok(Array.isArray(ingestHistory.json()));

  const scenarios = ['repairNotWorth', 'gamerLag', 'hardwareInvoice', 'smartphonePromo', 'complaintEmail'] as const;
  for (const name of scenarios) {
    const res = await app.inject({ method: 'POST', url: `/api/scenarios/${name}/run` });
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.ok(json.output.rankedActions.length >= 1, `scenario ${name} should produce at least one action`);
  }

  console.log(JSON.stringify({ ok: true, suite: 'apiE2E', timestamp: new Date().toISOString() }));
  await app.close();
}

void main();
