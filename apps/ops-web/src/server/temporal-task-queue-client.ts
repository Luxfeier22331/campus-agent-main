import { z } from "zod";
import type {
	OpsTemporalTaskQueueResult,
	OpsTemporalTaskQueueRow,
	OpsTemporalTaskQueueSource,
} from "./ops-status-store.ts";
import { logOpsError } from "./safe-logging.ts";

const CACHE_TTL_MS = 15_000;
const STALE_CACHE_TTL_MS = 5 * 60_000;
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
		return {
			getTaskQueues: async () => ({
				reason: "Temporal 队列查询未配置。",
				rows: [],
				state: "NOT_CONFIGURED",
			}),
		};
	}
	const fetchFn = input.fetchFn ?? fetch;
	const now = input.now ?? (() => new Date());
	let cachedRows: OpsTemporalTaskQueueRow[] | null = null;
	let cachedAt = 0;
	let inFlight: Promise<OpsTemporalTaskQueueResult> | null = null;

	return {
		async getTaskQueues() {
			const currentTime = now().valueOf();
			if (cachedRows && currentTime - cachedAt <= CACHE_TTL_MS) {
				return { rows: cachedRows, state: "FRESH" };
			}
			if (inFlight) {
				return inFlight;
			}
			inFlight = (async (): Promise<OpsTemporalTaskQueueResult> => {
				try {
					const response = await fetchFn(`${baseUrl}/internal/ops/temporal/task-queues`, {
						headers: { authorization: `Bearer ${bearerToken}` },
						signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					});
					if (!response.ok) {
						throw Object.assign(new Error("execution-control request failed"), {
							code: `HTTP_${response.status}`,
						});
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
					cachedAt = currentTime;
					return { rows: cachedRows, state: "FRESH" };
				} catch (error) {
					logOpsError("temporal task queue query failed", error, { source: "execution-control" });
					if (cachedRows && currentTime - cachedAt <= STALE_CACHE_TTL_MS) {
						return { rows: cachedRows, state: "STALE" };
					}
					return {
						reason: "Temporal 队列查询不可用。",
						rows: [],
						state: "UNAVAILABLE",
					};
				}
			})().finally(() => {
				inFlight = null;
			});
			return inFlight;
		},
	};
}
