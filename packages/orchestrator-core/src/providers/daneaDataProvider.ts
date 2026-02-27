import type { AgentProvider, OrchestratorContext } from '@bisp/shared-types';

export interface DaneaProviderData {
  invoiceCount: number;
  recentInvoiceTitles: string[];
}

/**
 * Provider che espone dati Danea già disponibili nel contesto.
 * In produzione potrebbe fare una query aggiornata al DB Danea.
 */
export function createDaneaDataProvider(): AgentProvider<DaneaProviderData> {
  return {
    name: 'danea',
    provide(ctx: OrchestratorContext): DaneaProviderData {
      return {
        invoiceCount: ctx.activeOffers.length,
        recentInvoiceTitles: ctx.activeOffers.slice(0, 5).map((o) => o.title),
      };
    },
  };
}
