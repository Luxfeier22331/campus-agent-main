import { Configuration } from "crawlee";

export function createOfficialWebCrawlerConfiguration(kind: string): Configuration {
	const runId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return new Configuration({
		defaultDatasetId: `official-web-${runId}`,
		defaultKeyValueStoreId: `official-web-${runId}`,
		defaultRequestQueueId: `official-web-${runId}`,
		persistStorage: false,
		purgeOnStart: true,
	});
}
