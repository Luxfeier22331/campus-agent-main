import { Configuration } from "crawlee";

export function createOfficialWebNextCrawlerConfiguration(kind: string): Configuration {
	const runId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return new Configuration({
		defaultDatasetId: `official-web-next-${runId}`,
		defaultKeyValueStoreId: `official-web-next-${runId}`,
		defaultRequestQueueId: `official-web-next-${runId}`,
		persistStorage: false,
		purgeOnStart: true,
	});
}
