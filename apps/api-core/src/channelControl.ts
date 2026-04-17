import {
  CHANNEL_ACTIONS,
  buildActionButtons,
  buildActionsText,
  buildHelpText,
  buildHomeText,
  buildIntegrationsText,
  buildMainButtons,
  buildStatusText,
  buildTraceText,
  buildWorkspaceText,
  formatCompactCount,
  isPanelAction,
  parseCommandAction,
  type ChannelActionId,
  type ChannelControlResponse,
  type ChannelInstruction,
  type ChannelPanelId,
  type ChannelPeerProfile,
  type ChannelPeerState,
  type ChannelSummarySnapshot,
  type ChannelTelemetryCounter,
  type ChannelTelemetrySnapshot,
  type SupportedControlChannel,
} from '@bisp/channel-control';
import type { ApiState } from './server';
import { makeAuditRecord } from '@bisp/shared-audit';
import type { ChannelControlEventRecord, ChannelControlPeerRecord, PostgresMirror } from './postgresMirror';

type PeerEventKind = 'text' | 'action' | 'panel' | 'workflow' | 'system';

interface ChannelPeerEvent {
  id: string;
  channel: SupportedControlChannel;
  peerId: string;
  kind: PeerEventKind;
  label: string;
  createdAt: string;
}

export interface ChannelControlRequest {
  channel: SupportedControlChannel;
  peerId: string;
  text?: string;
  actionId?: string;
  messageId?: string;
  profile?: ChannelPeerProfile;
}

function peerKey(channel: SupportedControlChannel, peerId: string): string {
  return `${channel}:${peerId}`;
}

function snippet(input: string, max = 90): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function boolFlag(value: boolean): string {
  return value ? 'on' : 'off';
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readChatSynthesis(
  message: string,
  sessionId?: string,
  source: 'whatsapp' | 'telegram' = 'telegram',
): Promise<{ synthesis: string; sessionId: string | null }> {
  const apiBase =
    process.env.COPILOTRM_API_URL ??
    process.env.API_CORE_URL ??
    `http://127.0.0.1:${process.env.PORT_API_CORE ?? 4010}`;

  const res = await fetch(`${apiBase}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bisp-role': 'admin',
    },
    body: JSON.stringify({ message, sessionId, source }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`chat endpoint failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let synthesis = '';
  let finalSessionId: string | null = sessionId ?? null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (raw.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(raw.slice(6)) as { type?: string; synthesis?: string; sessionId?: string; message?: string };
          if (parsed.type === 'done') {
            synthesis = parsed.synthesis ?? synthesis;
            finalSessionId = parsed.sessionId ?? finalSessionId;
          }
          if (parsed.type === 'error' && parsed.message) {
            throw new Error(parsed.message);
          }
        } catch (error) {
          if (error instanceof Error) throw error;
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  return {
    synthesis: synthesis.trim() || 'No response generated.',
    sessionId: finalSessionId,
  };
}

async function postOutboxAction<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const apiBase =
    process.env.COPILOTRM_API_URL ??
    process.env.API_CORE_URL ??
    `http://127.0.0.1:${process.env.PORT_API_CORE ?? 4010}`;
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bisp-role': 'admin',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(json.detail ?? json.error ?? `request failed (${res.status})`);
  }
  return json;
}

function renderApprovalsText(state: ApiState): string {
  const pending = state.drafts.list({ status: 'pending-approval' }).slice(0, 5);
  if (pending.length === 0) {
    return [
      'Pending approvals',
      '',
      'No drafts waiting for approval.',
    ].join('\n');
  }
  return [
    `Pending approvals ${formatCompactCount(state.drafts.list({ status: 'pending-approval' }).length)}`,
    '',
    ...pending.map((item, index) => `${index + 1}. [${item.draft.channel}] ${snippet(item.draft.subject ?? item.draft.body, 72)} (${item.draft.audience})`),
  ].join('\n');
}

function renderOutboxText(state: ApiState): string {
  const recent = state.drafts.list().slice(0, 6);
  const counts = {
    pending: state.drafts.list({ status: 'pending-approval' }).length,
    approved: state.drafts.list({ status: 'approved' }).length,
    queued: state.drafts.list({ status: 'queued' }).length,
    sent: state.drafts.list({ status: 'sent' }).length,
  };
  return [
    'Outbox',
    '',
    `Pending ${formatCompactCount(counts.pending)} · Approved ${formatCompactCount(counts.approved)} · Queued ${formatCompactCount(counts.queued)} · Sent ${formatCompactCount(counts.sent)}`,
    '',
    ...(recent.length > 0
      ? recent.map((item, index) => `${index + 1}. ${item.status.toUpperCase()} [${item.draft.channel}] ${snippet(item.draft.subject ?? item.draft.body, 68)}`)
      : ['No outbox activity yet.']),
  ].join('\n');
}

function renderKpiText(snapshot: ChannelSummarySnapshot): string {
  return [
    'KPI snapshot',
    '',
    `Customers ${formatCompactCount(snapshot.customers)}`,
    `Active offers ${formatCompactCount(snapshot.offersActive)}`,
    `Open tasks ${formatCompactCount(snapshot.tasksOpen)}`,
    `Pending approvals ${formatCompactCount(snapshot.pendingApprovals)}`,
    `Queued drafts ${formatCompactCount(snapshot.outboxQueued)}`,
    `Sent drafts ${formatCompactCount(snapshot.outboxSent)}`,
  ].join('\n');
}

function renderLookupText(state: ApiState, query: string): string {
  const needle = query.trim().toLowerCase();
  const customers = state.customers.list().filter((customer) =>
    customer.fullName.toLowerCase().includes(needle) ||
    customer.phone?.toLowerCase().includes(needle) ||
    customer.email?.toLowerCase().includes(needle)
  ).slice(0, 5);

  if (customers.length === 0) {
    return [
      'Customer lookup',
      '',
      `No customer found for "${query.trim()}".`,
    ].join('\n');
  }

  return [
    `Customer lookup ${formatCompactCount(customers.length)}`,
    '',
    ...customers.map((customer, index) => {
      const latest = customer.interactions.slice(-1)[0];
      return `${index + 1}. ${customer.fullName} · ${customer.phone ?? customer.email ?? 'no-contact'} · segments ${customer.segments.join(', ')}${latest ? ` · last ${snippet(latest.summary, 44)}` : ''}`;
    }),
  ].join('\n');
}

function baseButtonsForPanel(panel: ChannelPanelId): ChannelInstruction['buttons'] {
  if (panel === 'actions') return buildActionButtons();
  if (panel === 'workspace') {
    return [
      [
        { id: 'workflow:agenda-today', label: 'Agenda today' },
        { id: 'workflow:shifts-today', label: 'Shifts today' },
      ],
      [
        { id: 'workflow:meeting-create', label: 'Create meeting' },
        { id: 'workflow:workspace-refresh', label: 'Refresh data' },
      ],
      [
        { id: 'workflow:workspace-ask', label: 'Ask workspace' },
        { id: 'panel:home', label: 'Home' },
      ],
    ];
  }
  if (panel === 'approvals') {
    return [
      [
        { id: 'workflow:approve-next', label: 'Approve next' },
        { id: 'workflow:send-next', label: 'Send next' },
      ],
      [
        { id: 'panel:outbox', label: 'Outbox' },
        { id: 'panel:home', label: 'Home' },
      ],
    ];
  }
  if (panel === 'outbox') {
    return [
      [
        { id: 'workflow:send-next', label: 'Send next' },
        { id: 'panel:approvals', label: 'Approvals' },
      ],
      [
        { id: 'panel:actions', label: 'Actions' },
        { id: 'panel:home', label: 'Home' },
      ],
    ];
  }
  if (panel === 'help') {
    return [
      [
        { id: 'panel:actions', label: 'Actions' },
        { id: 'panel:home', label: 'Home' },
      ],
    ];
  }
  if (panel === 'status' || panel === 'integrations') {
    return [
      [
        { id: 'workflow:queue-health', label: 'Queue health' },
        { id: 'workflow:kpi', label: 'KPI' },
      ],
      [
        { id: 'panel:home', label: 'Home' },
        { id: 'panel:actions', label: 'Actions' },
      ],
    ];
  }
  return buildMainButtons();
}

export class ChannelControlRepository {
  private readonly postgresMirror?: PostgresMirror;
  private readonly peers = new Map<string, ChannelPeerState>();
  private readonly events: ChannelPeerEvent[] = [];

  constructor(postgresMirror?: PostgresMirror) {
    this.postgresMirror = postgresMirror;
  }

  hydrate(peers: ChannelControlPeerRecord[], events: ChannelControlEventRecord[]): void {
    this.peers.clear();
    this.events.splice(0, this.events.length);
    for (const peer of peers) {
      this.peers.set(peerKey(peer.channel, peer.peerId), {
        channel: peer.channel,
        peerId: peer.peerId,
        profile: peer.profile as ChannelPeerProfile | undefined,
        lastPanel: (peer.lastPanel as ChannelPanelId) ?? 'home',
        awaitingInputFor: peer.awaitingInputFor as ChannelPeerState['awaitingInputFor'],
        lastSessionId: peer.lastSessionId,
        updatedAt: peer.updatedAt,
      });
    }
    for (const event of events) {
      this.events.push({
        id: event.id,
        channel: event.channel,
        peerId: event.peerId,
        kind: event.kind,
        label: event.label,
        createdAt: event.createdAt,
      });
    }
  }

  touchPeer(channel: SupportedControlChannel, peerId: string, profile?: ChannelPeerProfile): ChannelPeerState {
    const key = peerKey(channel, peerId);
    const current = this.peers.get(key);
    const next: ChannelPeerState = {
      channel,
      peerId,
      profile: profile ?? current?.profile,
      lastPanel: current?.lastPanel ?? 'home',
      awaitingInputFor: current?.awaitingInputFor,
      lastSessionId: current?.lastSessionId,
      updatedAt: nowIso(),
    };
    this.peers.set(key, next);
    void this.postgresMirror?.saveChannelControlPeer({
      channel: next.channel,
      peerId: next.peerId,
      profile: next.profile as Record<string, unknown> | undefined,
      lastPanel: next.lastPanel,
      awaitingInputFor: next.awaitingInputFor,
      lastSessionId: next.lastSessionId,
      updatedAt: next.updatedAt,
    });
    return next;
  }

  getPeer(channel: SupportedControlChannel, peerId: string): ChannelPeerState | undefined {
    return this.peers.get(peerKey(channel, peerId));
  }

  updatePeer(channel: SupportedControlChannel, peerId: string, patch: Partial<ChannelPeerState>): ChannelPeerState {
    const current = this.touchPeer(channel, peerId);
    const next: ChannelPeerState = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    this.peers.set(peerKey(channel, peerId), next);
    void this.postgresMirror?.saveChannelControlPeer({
      channel: next.channel,
      peerId: next.peerId,
      profile: next.profile as Record<string, unknown> | undefined,
      lastPanel: next.lastPanel,
      awaitingInputFor: next.awaitingInputFor,
      lastSessionId: next.lastSessionId,
      updatedAt: next.updatedAt,
    });
    return next;
  }

  listPeers(): ChannelPeerState[] {
    return [...this.peers.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  record(channel: SupportedControlChannel, peerId: string, kind: PeerEventKind, label: string): void {
    this.events.push({
      id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      channel,
      peerId,
      kind,
      label,
      createdAt: nowIso(),
    });
    if (this.events.length > 1500) {
      this.events.splice(0, this.events.length - 1500);
    }
    const event = this.events[this.events.length - 1];
    if (event) {
      void this.postgresMirror?.saveChannelControlEvent({
        id: event.id,
        channel: event.channel,
        peerId: event.peerId,
        kind: event.kind,
        label: event.label,
        createdAt: event.createdAt,
      });
    }
  }

  async buildSummary(state: ApiState): Promise<ChannelSummarySnapshot> {
    const queue = await state.queueGateway.snapshot();
    const waiting = Object.values(queue.queues).reduce((sum, item) => sum + (item.waiting ?? 0), 0);
    const workspace = await state.workspace.buildAdminSnapshot();
    return {
      customers: state.customers.list().length,
      offersActive: state.offers.listActive().length,
      tasksOpen: state.tasks.list({ status: 'open' }).length,
      outboxPending: state.drafts.list({ status: 'pending-approval' }).length,
      outboxQueued: state.drafts.list({ status: 'queued' }).length,
      outboxSent: state.drafts.list({ status: 'sent' }).length,
      pendingApprovals: state.drafts.list({ status: 'pending-approval' }).length,
      queueMode: queue.mode,
      queueWaiting: waiting,
      integrations: {
        telegram: state.channels.telegram.configured,
        whatsapp: state.channels.whatsapp.configured,
        email: state.channels.email.configured,
        social: Boolean(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.TWITTER_BEARER_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN),
        llm: state.llm != null,
        googleWorkspace: state.workspace.configured,
      },
      workspace: {
        configured: workspace.summary.configured,
        lastSyncAt: workspace.summary.lastSyncAt,
        sheetRows: workspace.summary.sheetRows,
        calendarEvents: workspace.summary.calendarEvents,
        shiftsToday: workspace.summary.shiftRowsToday,
        meetingsUpcoming: workspace.summary.upcomingMeetings,
      },
    };
  }

  telemetry(): ChannelTelemetrySnapshot {
    const inboundByChannel: Record<SupportedControlChannel, number> = { telegram: 0, whatsapp: 0 };
    const topActions = new Map<string, number>();
    const topPanels = new Map<string, number>();

    for (const event of this.events) {
      inboundByChannel[event.channel] += 1;
      if (event.kind === 'action' || event.kind === 'workflow') {
        topActions.set(event.label, (topActions.get(event.label) ?? 0) + 1);
      }
      if (event.kind === 'panel') {
        topPanels.set(event.label, (topPanels.get(event.label) ?? 0) + 1);
      }
    }

    const toSortedCounters = (input: Map<string, number>): ChannelTelemetryCounter[] =>
      [...input.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, count]) => ({ label, count }));

    return {
      peersActive: this.peers.size,
      inboundByChannel,
      topActions: toSortedCounters(topActions),
      topPanels: toSortedCounters(topPanels),
      awaitingInputPeers: this.listPeers().filter((peer) => peer.awaitingInputFor).length,
    };
  }
}

function makePanelInstruction(panel: ChannelPanelId, snapshot: ChannelSummarySnapshot, state: ApiState, mode: 'new-message' | 'update-message'): ChannelInstruction {
  const text =
    panel === 'home'
      ? buildHomeText(snapshot)
      : panel === 'help'
        ? buildHelpText()
        : panel === 'actions'
          ? buildActionsText()
          : panel === 'workspace'
            ? buildWorkspaceText(snapshot)
          : panel === 'approvals'
            ? renderApprovalsText(state)
            : panel === 'outbox'
              ? renderOutboxText(state)
              : panel === 'integrations'
                ? buildIntegrationsText(snapshot)
                : buildStatusText(snapshot);
  return {
    mode,
    panel,
    text,
    buttons: baseButtonsForPanel(panel),
  };
}

async function handlePanelAction(repo: ChannelControlRepository, state: ApiState, peer: ChannelPeerState, actionId: Extract<ChannelActionId, `panel:${string}`> | 'workflow:refresh', prefersUpdate: boolean): Promise<ChannelControlResponse> {
  const snapshot = await repo.buildSummary(state);
  const panel: ChannelPanelId =
    actionId === 'workflow:refresh'
      ? peer.lastPanel
      : actionId.slice('panel:'.length) as ChannelPanelId;
  repo.updatePeer(peer.channel, peer.peerId, { lastPanel: panel, awaitingInputFor: undefined });
  repo.record(peer.channel, peer.peerId, 'panel', panel);
  return {
    handled: true,
    instructions: [makePanelInstruction(panel, snapshot, state, prefersUpdate ? 'update-message' : 'new-message')],
  };
}

export async function handleChannelControlRequest(repo: ChannelControlRepository, state: ApiState, request: ChannelControlRequest): Promise<ChannelControlResponse> {
  const text = request.text?.trim() ?? '';
  const peer = repo.touchPeer(request.channel, request.peerId, request.profile);
  const prefersUpdate = Boolean(request.messageId && request.actionId);

  const commandAction = text ? parseCommandAction(text) : undefined;
  const actionId = (request.actionId || commandAction) as ChannelActionId | undefined;

  if (actionId && CHANNEL_ACTIONS[actionId]) {
    if (
      actionId !== 'workflow:ask-swarm' &&
      actionId !== 'workflow:customer-lookup' &&
      actionId !== 'workflow:workspace-ask' &&
      actionId !== 'workflow:meeting-create'
    ) {
      repo.updatePeer(peer.channel, peer.peerId, { awaitingInputFor: undefined });
    }
    if (isPanelAction(actionId) || actionId === 'workflow:refresh') {
      return handlePanelAction(repo, state, peer, actionId as Extract<ChannelActionId, `panel:${string}`> | 'workflow:refresh', prefersUpdate);
    }

    repo.record(peer.channel, peer.peerId, actionId === 'workflow:ask-swarm' || actionId === 'workflow:customer-lookup' ? 'workflow' : 'action', actionId);

    if (actionId === 'workflow:kpi') {
      const snapshot = await repo.buildSummary(state);
      return {
        handled: true,
        callbackNotice: 'KPI ready',
        instructions: [{
          mode: prefersUpdate ? 'update-message' : 'new-message',
          text: renderKpiText(snapshot),
          buttons: [
            [
              { id: 'panel:home', label: 'Home' },
              { id: 'panel:actions', label: 'Actions' },
            ],
          ],
        }],
      };
    }

    if (actionId === 'workflow:agenda-today') {
      const result = await state.workspace.answerWorkspaceQuery('agenda oggi');
      return {
        handled: true,
        callbackNotice: 'Agenda today',
        instructions: [{
          mode: prefersUpdate ? 'update-message' : 'new-message',
          text: result.text,
          buttons: [
            [
              { id: 'panel:workspace', label: 'Workspace' },
              { id: 'workflow:agenda-upcoming', label: 'Upcoming agenda' },
            ],
          ],
        }],
      };
    }

    if (actionId === 'workflow:agenda-upcoming') {
      const result = await state.workspace.answerWorkspaceQuery('agenda domani e prossimi giorni');
      return {
        handled: true,
        callbackNotice: 'Upcoming agenda',
        instructions: [{
          mode: prefersUpdate ? 'update-message' : 'new-message',
          text: result.text,
          buttons: [
            [
              { id: 'panel:workspace', label: 'Workspace' },
              { id: 'workflow:agenda-today', label: 'Agenda today' },
            ],
          ],
        }],
      };
    }

    if (actionId === 'workflow:shifts-today') {
      const result = await state.workspace.answerWorkspaceQuery('chi è di turno oggi');
      return {
        handled: true,
        callbackNotice: 'Shifts today',
        instructions: [{
          mode: prefersUpdate ? 'update-message' : 'new-message',
          text: result.text,
          buttons: [
            [
              { id: 'panel:workspace', label: 'Workspace' },
              { id: 'workflow:workspace-ask', label: 'Ask workspace' },
            ],
          ],
        }],
      };
    }

    if (actionId === 'workflow:workspace-refresh') {
      const summary = await state.workspace.syncNow('channel-control');
      return {
        handled: true,
        callbackNotice: 'Workspace refreshed',
        instructions: [{
          mode: prefersUpdate ? 'update-message' : 'new-message',
          text: [
            'Workspace data refreshed.',
            '',
            `Sheet rows ${formatCompactCount(summary.sheetRows)}`,
            `Calendar events ${formatCompactCount(summary.calendarEvents)}`,
            `Today shifts ${formatCompactCount(summary.shiftRowsToday)}`,
            `Upcoming meetings ${formatCompactCount(summary.upcomingMeetings)}`,
          ].join('\n'),
          buttons: [
            [
              { id: 'panel:workspace', label: 'Workspace' },
              { id: 'workflow:agenda-today', label: 'Agenda today' },
            ],
          ],
        }],
      };
    }

    if (actionId === 'workflow:queue-health') {
      const snapshot = await repo.buildSummary(state);
      return {
        handled: true,
        callbackNotice: 'Queue status updated',
        instructions: [{
          mode: prefersUpdate ? 'update-message' : 'new-message',
          text: buildStatusText(snapshot),
          buttons: [
            [
              { id: 'panel:status', label: 'Status' },
              { id: 'panel:integrations', label: 'Integrations' },
            ],
            [
              { id: 'panel:home', label: 'Home' },
              { id: 'panel:actions', label: 'Actions' },
            ],
          ],
        }],
      };
    }

    if (
      actionId === 'workflow:ask-swarm' ||
      actionId === 'workflow:customer-lookup' ||
      actionId === 'workflow:workspace-ask' ||
      actionId === 'workflow:meeting-create'
    ) {
      repo.updatePeer(peer.channel, peer.peerId, { awaitingInputFor: actionId });
      return {
        handled: true,
        callbackNotice: CHANNEL_ACTIONS[actionId].label,
        instructions: [{
          mode: 'new-message',
          text: CHANNEL_ACTIONS[actionId].prompt ?? 'Send the next input.',
          buttons: [
            [
              { id: 'panel:actions', label: 'Actions' },
              { id: 'panel:home', label: 'Home' },
            ],
          ],
        }],
      };
    }

    if (actionId === 'workflow:approve-next') {
      const pending = state.drafts.list({ status: 'pending-approval' })[0];
      if (!pending) {
        return {
          handled: true,
          callbackNotice: 'No pending approvals',
          instructions: [{
            mode: 'new-message',
            text: 'No pending approvals.',
            buttons: [
              [
                { id: 'panel:approvals', label: 'Approvals' },
                { id: 'panel:home', label: 'Home' },
              ],
            ],
          }],
        };
      }
      const approved = state.drafts.update(pending.id, {
        status: 'approved',
        approvedBy: `${peer.channel}:${peer.peerId}`,
        approvedAt: nowIso(),
      });
      if (approved) {
        void state.postgresMirror.saveOutbox([approved]);
        state.audit.write(makeAuditRecord('channel-control', 'outbox.approved', {
          outboxId: approved.id,
          channel: approved.draft.channel,
          actor: `${peer.channel}:${peer.peerId}`,
        }));
      }
      return {
        handled: true,
        callbackNotice: 'Approved',
        instructions: [{
          mode: 'new-message',
          text: `Approved [${pending.draft.channel}] ${snippet(pending.draft.subject ?? pending.draft.body, 90)}`,
          buttons: [
            [
              { id: 'panel:approvals', label: 'Approvals' },
              { id: 'workflow:send-next', label: 'Send next' },
            ],
          ],
        }],
      };
    }

    if (actionId === 'workflow:send-next') {
      const candidate =
        state.drafts.list({ status: 'approved' })[0] ??
        state.drafts.list({ status: 'queued' })[0];
      if (!candidate) {
        return {
          handled: true,
          callbackNotice: 'Nothing to send',
          instructions: [{
            mode: 'new-message',
            text: 'No approved drafts waiting for dispatch.',
            buttons: [
              [
                { id: 'panel:outbox', label: 'Outbox' },
                { id: 'panel:home', label: 'Home' },
              ],
            ],
          }],
        };
      }
      try {
        await postOutboxAction(`/api/outbox/${candidate.id}/send`);
        return {
          handled: true,
          callbackNotice: 'Sent',
          instructions: [{
            mode: 'new-message',
            text: `Sent [${candidate.draft.channel}] ${snippet(candidate.draft.subject ?? candidate.draft.body, 90)}`,
            buttons: [
              [
                { id: 'panel:outbox', label: 'Outbox' },
                { id: 'panel:status', label: 'Status' },
              ],
            ],
          }],
        };
      } catch (error) {
        return {
          handled: true,
          callbackNotice: 'Send failed',
          instructions: [{
            mode: 'new-message',
            text: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
            buttons: [
              [
                { id: 'panel:outbox', label: 'Outbox' },
                { id: 'panel:approvals', label: 'Approvals' },
              ],
            ],
          }],
        };
      }
    }
  }

  if (text) {
    repo.record(peer.channel, peer.peerId, 'text', text.length > 48 ? `${text.slice(0, 48)}…` : text);
  }

  if (text && peer.awaitingInputFor === 'workflow:customer-lookup') {
    repo.updatePeer(peer.channel, peer.peerId, { awaitingInputFor: undefined });
    return {
      handled: true,
      instructions: [
        {
          mode: 'new-message',
          text: buildTraceText('workflow:customer-lookup', text),
        },
        {
          mode: 'new-message',
          text: renderLookupText(state, text),
          buttons: [
            [
              { id: 'panel:actions', label: 'Actions' },
              { id: 'panel:home', label: 'Home' },
            ],
          ],
        },
      ],
    };
  }

  if (text && peer.awaitingInputFor === 'workflow:meeting-create') {
    repo.updatePeer(peer.channel, peer.peerId, { awaitingInputFor: undefined });
    const result = await state.workspace.createMeetingFromText(text);
    return {
      handled: true,
      instructions: [
        {
          mode: 'new-message',
          text: buildTraceText('workflow:meeting-create', text),
        },
        {
          mode: 'new-message',
          text: result.text,
          buttons: [
            [
              { id: 'panel:workspace', label: 'Workspace' },
              { id: 'workflow:agenda-today', label: 'Agenda today' },
            ],
          ],
        },
      ],
    };
  }

  if (text && peer.awaitingInputFor === 'workflow:workspace-ask') {
    repo.updatePeer(peer.channel, peer.peerId, { awaitingInputFor: undefined });
    const result = await state.workspace.answerWorkspaceQuery(text);
    return {
      handled: true,
      instructions: [
        {
          mode: 'new-message',
          text: buildTraceText('workflow:workspace-ask', text),
        },
        {
          mode: 'new-message',
          text: result.handled ? result.text : 'No workspace answer available for that request.',
          buttons: [
            [
              { id: 'panel:workspace', label: 'Workspace' },
              { id: 'panel:home', label: 'Home' },
            ],
          ],
        },
      ],
    };
  }

  if (text) {
    const workspaceResult = await state.workspace.answerWorkspaceQuery(text);
    if (workspaceResult.handled) {
      return {
        handled: true,
        instructions: [
          ...(workspaceResult.trace
            ? [{
                mode: 'new-message' as const,
                text: workspaceResult.trace,
              }]
            : []),
          {
            mode: 'new-message',
            text: workspaceResult.text,
            buttons: [
              [
                { id: 'panel:workspace', label: 'Workspace' },
                { id: 'panel:home', label: 'Home' },
              ],
            ],
          },
        ],
      };
    }
  }

  if (text && (peer.awaitingInputFor === 'workflow:ask-swarm' || !commandAction)) {
    if (peer.awaitingInputFor === 'workflow:ask-swarm') {
      repo.updatePeer(peer.channel, peer.peerId, { awaitingInputFor: undefined });
    }
    try {
      const source = peer.channel === 'whatsapp' ? 'whatsapp' : 'telegram';
      const { synthesis, sessionId } = await readChatSynthesis(text, peer.lastSessionId, source);
      repo.updatePeer(peer.channel, peer.peerId, { lastSessionId: sessionId ?? undefined });
      return {
        handled: true,
        instructions: [
          ...(peer.awaitingInputFor === 'workflow:ask-swarm'
            ? [{
                mode: 'new-message' as const,
                text: buildTraceText('workflow:ask-swarm', text),
              }]
            : []),
          {
            mode: 'new-message',
            text: synthesis,
            buttons: [
              [
                { id: 'panel:actions', label: 'Actions' },
                { id: 'panel:home', label: 'Home' },
              ],
            ],
          },
        ],
      };
    } catch (error) {
      return {
        handled: true,
        instructions: [{
          mode: 'new-message',
          text: `Chat failed: ${error instanceof Error ? error.message : String(error)}`,
          buttons: [
            [
              { id: 'panel:actions', label: 'Actions' },
              { id: 'panel:home', label: 'Home' },
            ],
          ],
        }],
      };
    }
  }

  return handlePanelAction(repo, state, peer, 'panel:home', false);
}
