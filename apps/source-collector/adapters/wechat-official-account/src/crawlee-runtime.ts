import { Configuration } from "crawlee";

export function createWeChatCrawlerConfiguration(kind: string): Configuration {
	const runId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return new Configuration({
		defaultDatasetId: `wechat-official-account-${runId}`,
		defaultKeyValueStoreId: `wechat-official-account-${runId}`,
		defaultRequestQueueId: `wechat-official-account-${runId}`,
		persistStorage: false,
		purgeOnStart: true,
	});
}
