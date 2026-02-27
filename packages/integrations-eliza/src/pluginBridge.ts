export interface ElizaPluginRef {
  packageName: string;
  capability: string;
  mode: 'reuse' | 'adapt' | 'reference';
  notes: string;
}

export const DEFAULT_ELIZA_PLUGIN_MAP: ElizaPluginRef[] = [
  { packageName: 'packages/plugin-email-automation', capability: 'one-to-one email automation', mode: 'adapt', notes: 'Wrap via integrations-email with policy/audit' },
  { packageName: 'packages/client-telegram', capability: 'telegram channel client', mode: 'adapt', notes: 'Wrap via integrations-telegram and scheduler' },
  { packageName: 'packages/core knowledge/ragknowledge', capability: 'RAG patterns', mode: 'reuse', notes: 'Reimplemented contract-first in integrations-eliza' },
];
