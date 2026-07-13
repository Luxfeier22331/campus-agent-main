import { z } from "zod";
import type { OpsTemporalTaskQueueRow, OpsTemporalTaskQueueSource } from "./ops-status-store.ts";

const CACHE_TTL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

const TemporalTaskQueueResponseSchema = z.object({
	queues: z.array(
		z.object({
			backlogCount: z.number().int().nonnegative().nullable(),
			name: z.string().min(1),
			oldestTaskAgeSeconds: z.number().nonnegative().nullable(),
			pollerCount: z.number().int().nonnegative(),
			type: z.enum(["workflow", "activity"]),
		}),
	),
	sampledAt: z.string().datetime(),
});

export function createTemporalTaskQueueSource(input: {
	baseUrl: string;
	bearerToken: string;
	fetchFn?: typeof fetch;
	now?: () => Date;
}): OpsTemporalTaskQueueSource {
	const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
	const bearerToken = input.bearerToken.trim();
	if (!(baseUrl && bearerToken)) {
		return { getTaskQueues: async () => [] };
	}
	const fetchFn = input.fetchFn ?? fetch;
	const now = input.now ?? (() => new Date());
	let cachedRows: OpsTemporalTaskQueueRow[] | null = null;
	let cacheExpiresAt = 0;

	return {
		async getTaskQueues() {
			const currentTime = now().valueOf();
			if (cachedRows && currentTime < cacheExpiresAt) {
				return cachedRows;
			}
			try {
				const response = await fetchFn(`${baseUrl}/internal/ops/temporal/task-queues`, {
					headers: { authorization: `Bearer ${bearerToken}` },
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				if (!response.ok) {
					throw new Error(`execution-control returned HTTP ${response.status}`);
				}
				const payload = TemporalTaskQueueResponseSchema.parse(await response.json());
				const sampledAt = new Date(payload.sampledAt);
				cachedRows = payload.queues.map((queue) => ({
					backlogJson:
						queue.backlogCount === null
							? { state: "unsupported_by_source" }
							: { count: queue.backlogCount, state: "observed" },
					oldestTaskAgeJson:
						queue.oldestTaskAgeSeconds === null
							? { state: "unsupported_by_source" }
							: { ms: Math.round(queue.oldestTaskAgeSeconds * 1000), state: "observed" },
					pollerCount: queue.pollerCount,
					projectedAt: sampledAt,
					taskQueue: queue.name,
					taskQueueKind: queue.type,
				}));
				cacheExpiresAt = currentTime + CACHE_TTL_MS;
				return cachedRows;
			} catch (error) {
				console.error("[ops-web] temporal task queue query failed", {
					message: error instanceof Error ? error.message : String(error),
				});
				return cachedRows ?? [];
			}
		},
	};
}
