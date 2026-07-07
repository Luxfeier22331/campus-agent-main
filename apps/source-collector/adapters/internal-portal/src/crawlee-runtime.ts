import { Configuration } from "crawlee";

export function createAuthenticatedNoticeCrawlerConfiguration(kind: string): Configuration {
	const runId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return new Configuration({
		defaultDatasetId: `authenticated-notice-${runId}`,
		defaultKeyValueStoreId: `authenticated-notice-${runId}`,
		defaultRequestQueueId: `authenticated-notice-${runId}`,
		persistStorage: false,
		purgeOnStart: true,
	});
}
