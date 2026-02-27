import type { AgentProvider, OrchestratorContext } from '@bisp/shared-types';
import { fetchAllRssFeeds, RssStateTracker, type RssItem, type RssSource } from '@bisp/integrations-rss';

export interface RssNewsProviderData {
  items: RssItem[];
  fetchedAt: string;
}

/**
 * Provider che scarica news RSS e le inietta nel contesto dell'orchestrator.
 * Usa RssStateTracker per non rielaborare news già viste.
 */
export function createRssNewsProvider(
  sources: RssSource[],
  tracker?: RssStateTracker
): AgentProvider<RssNewsProviderData> {
  const _tracker = tracker ?? new RssStateTracker();
  return {
    name: 'rss-news',
    async provide(_ctx: OrchestratorContext): Promise<RssNewsProviderData> {
      const all = await fetchAllRssFeeds(sources);
      const newItems = _tracker.filterNew(all);
      _tracker.markSeen(newItems);
      return { items: newItems, fetchedAt: new Date().toISOString() };
    },
  };
}
