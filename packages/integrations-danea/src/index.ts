import type { DaneaInvoiceLine, DomainEvent } from '@bisp/shared-types';

export interface DaneaReadOnlyInvoice {
  id: string;
  supplierName: string;
  receivedAt: string;
  lines: DaneaInvoiceLine[];
}

export class DaneaReadOnlyStub {
  listRecentInvoices(): DaneaReadOnlyInvoice[] {
    return [
      {
        id: 'inv_demo_1',
        supplierName: 'Fornitore Hardware Srl',
        receivedAt: new Date().toISOString(),
        lines: [{ description: 'RTX 3090 1500€', qty: 1, unitCost: 1500 }],
      },
    ];
  }

  toDomainEvent(invoice: DaneaReadOnlyInvoice): DomainEvent<{ invoiceId: string; lines: DaneaInvoiceLine[] }> {
    return {
      id: `evt_${invoice.id}`,
      type: 'danea.invoice.ingested',
      occurredAt: invoice.receivedAt,
      payload: { invoiceId: invoice.id, lines: invoice.lines },
    };
  }
}
