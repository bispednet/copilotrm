import type { ProductOffer } from '@bisp/shared-types';

export class OfferRepository {
  private offers = new Map<string, ProductOffer>();

  upsert(offer: ProductOffer): void {
    this.offers.set(offer.id, offer);
  }

  listActive(): ProductOffer[] {
    return [...this.offers.values()].filter((o) => o.active);
  }

  listAll(): ProductOffer[] {
    return [...this.offers.values()];
  }

  listBySegment(segment: ProductOffer['targetSegments'][number]): ProductOffer[] {
    return this.listActive().filter((o) => o.targetSegments.includes(segment));
  }

  listByCategory(category: ProductOffer['category']): ProductOffer[] {
    return this.listActive().filter((o) => o.category === category);
  }

  getById(id: string): ProductOffer | undefined {
    return this.offers.get(id);
  }

  replaceAll(offers: ProductOffer[]): void {
    this.offers.clear();
    offers.forEach((o) => this.offers.set(o.id, o));
  }
}
