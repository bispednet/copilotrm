export type SupportedControlChannel = 'telegram' | 'whatsapp';

export type ChannelPanelId =
  | 'home'
  | 'help'
  | 'actions'
  | 'workspace'
  | 'approvals'
  | 'outbox'
  | 'status'
  | 'integrations';

export type ChannelActionId =
  | 'panel:home'
  | 'panel:help'
  | 'panel:actions'
  | 'panel:workspace'
  | 'panel:approvals'
  | 'panel:outbox'
  | 'panel:status'
  | 'panel:integrations'
  | 'workflow:refresh'
  | 'workflow:kpi'
  | 'workflow:queue-health'
  | 'workflow:ask-swarm'
  | 'workflow:workspace-ask'
  | 'workflow:workspace-refresh'
  | 'workflow:agenda-today'
  | 'workflow:agenda-upcoming'
  | 'workflow:shifts-today'
  | 'workflow:meeting-create'
  | 'workflow:customer-lookup'
  | 'workflow:approve-next'
  | 'workflow:send-next';

export interface ChannelPeerProfile {
  displayName?: string;
  username?: string;
  groupName?: string;
  peerType?: 'private' | 'group';
  participantId?: string;
  participantName?: string;
}

export interface ChannelPeerState {
  channel: SupportedControlChannel;
  peerId: string;
  profile?: ChannelPeerProfile;
  lastPanel: ChannelPanelId;
  awaitingInputFor?: Extract<ChannelActionId, 'workflow:ask-swarm' | 'workflow:customer-lookup' | 'workflow:workspace-ask' | 'workflow:meeting-create'>;
  lastSessionId?: string;
  updatedAt: string;
}

export interface ChannelSummarySnapshot {
  customers: number;
  offersActive: number;
  tasksOpen: number;
  outboxPending: number;
  outboxQueued: number;
  outboxSent: number;
  pendingApprovals: number;
  queueMode: 'inline' | 'redis';
  queueWaiting: number;
  integrations: {
    telegram: boolean;
    whatsapp: boolean;
    email: boolean;
    social: boolean;
    llm: boolean;
    googleWorkspace: boolean;
  };
  workspace: {
    configured: boolean;
    lastSyncAt?: string;
    sheetRows: number;
    calendarEvents: number;
    shiftsToday: number;
    meetingsUpcoming: number;
  };
}

export interface ChannelButton {
  id: ChannelActionId | string;
  label: string;
  url?: string;
}

export interface ChannelInstruction {
  mode: 'new-message' | 'update-message';
  panel?: ChannelPanelId;
  text: string;
  buttons?: ChannelButton[][];
}

export interface ChannelControlResponse {
  handled: boolean;
  callbackNotice?: string;
  instructions: ChannelInstruction[];
}

export interface ChannelTelemetryCounter {
  label: string;
  count: number;
}

export interface ChannelTelemetrySnapshot {
  peersActive: number;
  inboundByChannel: Record<SupportedControlChannel, number>;
  topActions: ChannelTelemetryCounter[];
  topPanels: ChannelTelemetryCounter[];
  awaitingInputPeers: number;
}

export interface ChannelActionDefinition {
  id: ChannelActionId;
  label: string;
  description: string;
  requiresInput?: boolean;
  prompt?: string;
  traceLabel?: string;
}

export const CHANNEL_ACTIONS: Record<ChannelActionId, ChannelActionDefinition> = {
  'panel:home': {
    id: 'panel:home',
    label: 'Home',
    description: 'Open the main control panel.',
    traceLabel: 'Home panel',
  },
  'panel:help': {
    id: 'panel:help',
    label: 'Help',
    description: 'Show usage guidance and supported flows.',
    traceLabel: 'Help panel',
  },
  'panel:actions': {
    id: 'panel:actions',
    label: 'Actions',
    description: 'Open the quick action catalog.',
    traceLabel: 'Actions panel',
  },
  'panel:workspace': {
    id: 'panel:workspace',
    label: 'Workspace',
    description: 'Open agenda, shifts, and shared operations data.',
    traceLabel: 'Workspace panel',
  },
  'panel:approvals': {
    id: 'panel:approvals',
    label: 'Approvals',
    description: 'Inspect pending approvals.',
    traceLabel: 'Approvals panel',
  },
  'panel:outbox': {
    id: 'panel:outbox',
    label: 'Outbox',
    description: 'Inspect queued and sent drafts.',
    traceLabel: 'Outbox panel',
  },
  'panel:status': {
    id: 'panel:status',
    label: 'Status',
    description: 'Show integrations and queue health.',
    traceLabel: 'Status panel',
  },
  'panel:integrations': {
    id: 'panel:integrations',
    label: 'Integrations',
    description: 'Show adapter availability.',
    traceLabel: 'Integrations panel',
  },
  'workflow:refresh': {
    id: 'workflow:refresh',
    label: 'Refresh',
    description: 'Refresh the current panel.',
    traceLabel: 'Refresh panel',
  },
  'workflow:kpi': {
    id: 'workflow:kpi',
    label: 'KPI snapshot',
    description: 'Show the top live operating numbers.',
    traceLabel: 'KPI snapshot',
  },
  'workflow:queue-health': {
    id: 'workflow:queue-health',
    label: 'Queue health',
    description: 'Inspect current queue waiting jobs.',
    traceLabel: 'Queue health',
  },
  'workflow:ask-swarm': {
    id: 'workflow:ask-swarm',
    label: 'Ask swarm',
    description: 'Send a free-text request to the conversational engine.',
    requiresInput: true,
    prompt: 'Send the next message as a plain-language request for the CRM swarm.',
    traceLabel: 'Ask swarm',
  },
  'workflow:workspace-ask': {
    id: 'workflow:workspace-ask',
    label: 'Ask workspace',
    description: 'Ask about shifts, shared agenda, meetings, or sheet data in plain language.',
    requiresInput: true,
    prompt: 'Send the next message as a normal-language question about agenda, meetings, shifts, employee hours, or shared sheets.',
    traceLabel: 'Ask workspace',
  },
  'workflow:workspace-refresh': {
    id: 'workflow:workspace-refresh',
    label: 'Refresh workspace',
    description: 'Refresh Google Sheets and Calendar data now.',
    traceLabel: 'Refresh workspace',
  },
  'workflow:agenda-today': {
    id: 'workflow:agenda-today',
    label: 'Agenda today',
    description: 'Show today shared agenda and meetings.',
    traceLabel: 'Agenda today',
  },
  'workflow:agenda-upcoming': {
    id: 'workflow:agenda-upcoming',
    label: 'Upcoming agenda',
    description: 'Show upcoming agenda and meeting schedule.',
    traceLabel: 'Upcoming agenda',
  },
  'workflow:shifts-today': {
    id: 'workflow:shifts-today',
    label: 'Shifts today',
    description: 'Show today shifts and staff availability.',
    traceLabel: 'Shifts today',
  },
  'workflow:meeting-create': {
    id: 'workflow:meeting-create',
    label: 'Create meeting',
    description: 'Create a Google Calendar meeting invite from a natural-language request.',
    requiresInput: true,
    prompt: 'Send the next message in plain language. Example: "Domani alle 10:30 riunione commerciale con Mario e Lucia per 45 minuti".',
    traceLabel: 'Create meeting',
  },
  'workflow:customer-lookup': {
    id: 'workflow:customer-lookup',
    label: 'Customer lookup',
    description: 'Search a customer by name, phone, or email.',
    requiresInput: true,
    prompt: 'Send the next message with a customer name, phone number, or email.',
    traceLabel: 'Customer lookup',
  },
  'workflow:approve-next': {
    id: 'workflow:approve-next',
    label: 'Approve next',
    description: 'Approve the first pending draft.',
    traceLabel: 'Approve next draft',
  },
  'workflow:send-next': {
    id: 'workflow:send-next',
    label: 'Send next approved',
    description: 'Send the first approved draft waiting for dispatch.',
    traceLabel: 'Send next approved draft',
  },
};

export function isPanelAction(id: string): id is Extract<ChannelActionId, `panel:${string}`> {
  return id.startsWith('panel:');
}

export function isWorkflowAction(id: string): id is Extract<ChannelActionId, `workflow:${string}`> {
  return id.startsWith('workflow:');
}

export function parseCommandAction(text: string): ChannelActionId | undefined {
  const normalized = text.trim().toLowerCase();
  if (normalized === '/start' || normalized === '/home') return 'panel:home';
  if (normalized === '/help') return 'panel:help';
  if (normalized === '/actions') return 'panel:actions';
  if (normalized === '/workspace' || normalized === '/agenda') return 'panel:workspace';
  if (normalized === '/approvals') return 'panel:approvals';
  if (normalized === '/outbox') return 'panel:outbox';
  if (normalized === '/status') return 'panel:status';
  if (normalized === '/integrations') return 'panel:integrations';
  if (normalized === '/kpi') return 'workflow:kpi';
  if (normalized === '/turni') return 'workflow:shifts-today';
  if (normalized === '/meeting') return 'workflow:meeting-create';
  return undefined;
}

export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function boolFlag(value: boolean): string {
  return value ? 'on' : 'off';
}

export function buildHomeText(snapshot: ChannelSummarySnapshot): string {
  return [
    'CopilotRM channel control',
    '',
    `Customers ${formatCompactCount(snapshot.customers)}`,
    `Active offers ${formatCompactCount(snapshot.offersActive)}`,
    `Open tasks ${formatCompactCount(snapshot.tasksOpen)}`,
    `Pending approvals ${formatCompactCount(snapshot.pendingApprovals)}`,
    `Queued drafts ${formatCompactCount(snapshot.outboxQueued)}`,
    `Sent drafts ${formatCompactCount(snapshot.outboxSent)}`,
    '',
    `Workspace ${boolFlag(snapshot.workspace.configured)} · Sheet rows ${formatCompactCount(snapshot.workspace.sheetRows)} · Events ${formatCompactCount(snapshot.workspace.calendarEvents)}`,
    `Today shifts ${formatCompactCount(snapshot.workspace.shiftsToday)} · Upcoming meetings ${formatCompactCount(snapshot.workspace.meetingsUpcoming)}`,
    '',
    `Telegram ${boolFlag(snapshot.integrations.telegram)} · WhatsApp ${boolFlag(snapshot.integrations.whatsapp)} · Email ${boolFlag(snapshot.integrations.email)} · Social ${boolFlag(snapshot.integrations.social)} · Google ${boolFlag(snapshot.integrations.googleWorkspace)}`,
    `LLM ${boolFlag(snapshot.integrations.llm)} · Queue ${snapshot.queueMode}${snapshot.queueMode === 'redis' ? ` (${formatCompactCount(snapshot.queueWaiting)} waiting)` : ''}`,
  ].join('\n');
}

export function buildHelpText(): string {
  return [
    'CopilotRM bot control surface',
    '',
    'Use quick actions to inspect approvals, outbox, queue health, integrations, workspace, and KPI.',
    'Use Ask swarm for a normal-language CRM request.',
    'Use Ask workspace for agenda, meetings, shifts, sheet data, employee hours, and shared knowledge.',
    'Use Customer lookup for name, phone, or email queries.',
    '',
    'Main commands:',
    '/start, /help, /actions, /workspace, /agenda, /turni, /meeting, /approvals, /outbox, /status, /integrations, /kpi',
  ].join('\n');
}

export function buildActionsText(): string {
  return [
    'Quick actions',
    '',
    'Pick an action below or send a normal message to use the conversational engine.',
  ].join('\n');
}

export function buildStatusText(snapshot: ChannelSummarySnapshot): string {
  return [
    'Channel runtime status',
    '',
    `Queue mode ${snapshot.queueMode}`,
    `Queue waiting ${formatCompactCount(snapshot.queueWaiting)}`,
    `Pending approvals ${formatCompactCount(snapshot.pendingApprovals)}`,
    `Outbox pending ${formatCompactCount(snapshot.outboxPending)}`,
    `Outbox queued ${formatCompactCount(snapshot.outboxQueued)}`,
    `Outbox sent ${formatCompactCount(snapshot.outboxSent)}`,
    `Workspace configured ${boolFlag(snapshot.workspace.configured)}`,
    `Workspace last sync ${snapshot.workspace.lastSyncAt ?? 'never'}`,
  ].join('\n');
}

export function buildIntegrationsText(snapshot: ChannelSummarySnapshot): string {
  return [
    'Integrations',
    '',
    `Telegram ${boolFlag(snapshot.integrations.telegram)}`,
    `WhatsApp ${boolFlag(snapshot.integrations.whatsapp)}`,
    `Email ${boolFlag(snapshot.integrations.email)}`,
    `Social ${boolFlag(snapshot.integrations.social)}`,
    `LLM ${boolFlag(snapshot.integrations.llm)}`,
    `Google Workspace ${boolFlag(snapshot.integrations.googleWorkspace)}`,
  ].join('\n');
}

export function buildWorkspaceText(snapshot: ChannelSummarySnapshot): string {
  return [
    'Workspace control',
    '',
    `Configured ${boolFlag(snapshot.workspace.configured)}`,
    `Last sync ${snapshot.workspace.lastSyncAt ?? 'never'}`,
    `Sheet rows ${formatCompactCount(snapshot.workspace.sheetRows)}`,
    `Calendar events ${formatCompactCount(snapshot.workspace.calendarEvents)}`,
    `Today shifts ${formatCompactCount(snapshot.workspace.shiftsToday)}`,
    `Upcoming meetings ${formatCompactCount(snapshot.workspace.meetingsUpcoming)}`,
    '',
    'Use the buttons below or ask in plain language:',
    '“Chi è di turno oggi?”',
    '“Che appuntamenti abbiamo domani?”',
    '“Crea una riunione domani alle 10 con Mario e Lucia per 45 minuti”',
  ].join('\n');
}

export function buildMainButtons(): ChannelButton[][] {
  return [
    [
      { id: 'panel:actions', label: 'Actions' },
      { id: 'panel:workspace', label: 'Workspace' },
    ],
    [
      { id: 'panel:approvals', label: 'Approvals' },
      { id: 'panel:outbox', label: 'Outbox' },
    ],
    [
      { id: 'panel:status', label: 'Status' },
      { id: 'panel:help', label: 'Help' },
    ],
    [
      { id: 'workflow:refresh', label: 'Refresh' },
    ],
  ];
}

export function buildActionButtons(): ChannelButton[][] {
  return [
    [
      { id: 'workflow:kpi', label: 'KPI' },
      { id: 'workflow:queue-health', label: 'Queue' },
    ],
    [
      { id: 'workflow:approve-next', label: 'Approve next' },
      { id: 'workflow:send-next', label: 'Send next' },
    ],
    [
      { id: 'workflow:customer-lookup', label: 'Lookup customer' },
      { id: 'workflow:ask-swarm', label: 'Ask swarm' },
    ],
    [
      { id: 'workflow:agenda-today', label: 'Agenda today' },
      { id: 'workflow:shifts-today', label: 'Shifts today' },
    ],
    [
      { id: 'workflow:workspace-ask', label: 'Ask workspace' },
      { id: 'workflow:meeting-create', label: 'Create meeting' },
    ],
    [
      { id: 'panel:home', label: 'Home' },
      { id: 'panel:workspace', label: 'Workspace' },
    ],
    [
      { id: 'panel:help', label: 'Help' },
    ],
  ];
}

export function buildTraceText(actionId: ChannelActionId, input?: string): string {
  const action = CHANNEL_ACTIONS[actionId];
  if (!action) return input ? `User request: ${input}` : 'User request';
  if (input?.trim()) return `User request: ${action.label} — ${input.trim()}`;
  return `User request: ${action.traceLabel ?? action.label}`;
}
