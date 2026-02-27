export interface ProductCatalogItem {
  id: string;
  ean?: string;
  title: string;
  category: string;
  stockQty: number;
  cost: number;
  suggestedPrice: number;
}

export class ProductCatalogRepository {
  private items = new Map<string, ProductCatalogItem>();

  upsert(item: ProductCatalogItem): void {
    this.items.set(item.id, item);
  }

  list(): ProductCatalogItem[] {
    return [...this.items.values()];
  }
}
