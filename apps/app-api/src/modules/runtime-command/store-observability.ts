import { and, eq, sql } from "drizzle-orm";

import type { RuntimeDbGetter } from "../../db/runtime";
import { requestObservabilityFact } from "../../db/schema";
import { withStreamOrchestrationOverhead } from "./store-observability-timing";
import type { ChatCommandObservabilityStore } from "./store-types";

export function createPgChatCommandObservabilityStore(
	getDb: RuntimeDbGetter,
): ChatCommandObservabilityStore {
	return {
		async recordStreamAppApiTtft(input) {
			const db = await getDb();
			const timing = requestObservabilityFact.stageTimingJson;
			const timingWithTtft = sql<Record<string, unknown>>`jsonb_set(
				${timing},
				array['stream.app_api_ttft_ms'],
				to_jsonb(${input.durationMs}::double precision),
				true
			)`;
			const updated = await db
				.update(requestObservabilityFact)
				.set({
					stageTimingJson: withStreamOrchestrationOverhead(timingWithTtft),
					updatedAt: sql<Date>`greatest(
						${requestObservabilityFact.updatedAt},
						${new Date(input.observedAt)}
					)`,
				})
				.where(
					and(
						eq(requestObservabilityFact.requestId, input.requestId),
						sql`not (${requestObservabilityFact.stageTimingJson} ? 'stream.app_api_ttft_ms')`,
					),
				)
				.returning({ requestId: requestObservabilityFact.requestId });
			return updated.length === 1;
		},

		async readRequestStageTiming(requestId) {
			const db = await getDb();
			const rows = await db
				.select({ stageTiming: requestObservabilityFact.stageTimingJson })
				.from(requestObservabilityFact)
				.where(eq(requestObservabilityFact.requestId, requestId))
				.limit(1);
			if (!rows[0]) {
				throw new Error(`Request observability fact ${requestId} was not found.`);
			}
			return rows[0].stageTiming;
		},
		async recordClientTiming(input) {
			const db = await getDb();
			const timing = requestObservabilityFact.stageTimingJson;
			const updated = await db
				.update(requestObservabilityFact)
				.set({
					stageTimingJson: sql`jsonb_set(jsonb_set(${timing}, array['client.first_delta_ms'], to_jsonb(${input.firstDeltaMs}::double precision), true), array['client.first_render_ms'], to_jsonb(${input.firstRenderMs}::double precision), true)`,
					updatedAt: sql<Date>`greatest(${requestObservabilityFact.updatedAt}, ${new Date(input.observedAt)})`,
				})
				.where(
					and(
						eq(requestObservabilityFact.requestId, input.requestId),
						sql`not (${timing} ? 'client.first_delta_ms')`,
					),
				)
				.returning({ requestId: requestObservabilityFact.requestId });
			return updated.length === 1;
		},
	};
}
