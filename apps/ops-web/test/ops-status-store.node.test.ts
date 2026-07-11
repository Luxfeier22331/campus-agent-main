// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createPgOpsStatusStore } from "../src/server/pg-ops-status-store";
import { OpsRequestDetailResponseSchema } from "../src/shared/ops-contract";
import {
	createFakeOpsDb,
	requestProjectionRow,
	requiredTemporalQueueRows,
} from "./ops-status-store-test-helpers";

const now = new Date("2026-07-09T07:30:00.000Z");

describe("PostgreSQL ops status store", () => {
	it("builds windowed request and Temporal overview data", async () => {
		const store = createPgOpsStatusStore({ db: createFakeOpsDb(), now: () => now });
		const overview = await store.getOverview("1h");

		expect(overview.requests).toMatchObject({
			completed: 1,
			dataState: "FRESH",
			status: "HEALTHY",
			total: 1,
		});
		expect(overview.temporal).toMatchObject({
			dataState: "FRESH",
			pollerCount: 16,
			status: "HEALTHY",
		});
		expect(overview.temporal.queues).toHaveLength(4);
		expect(overview.trends).toHaveLength(1);
	});

	it("represents a quiet request window as no data instead of stale", async () => {
		const db = createFakeOpsDb({
			requestRows: [
				requestProjectionRow({
					projectedAt: new Date("2026-07-08T07:29:05.000Z"),
					startedAt: new Date("2026-07-08T07:29:00.000Z"),
				}),
			],
		});
		const store = createPgOpsStatusStore({ db, now: () => now });

		expect((await store.getOverview("1h")).requests).toMatchObject({
			dataState: "NO_DATA",
			status: "UNKNOWN",
			total: 0,
		});
	});

	it("does not degrade Temporal only because one task age metric is unsupported", async () => {
		const db = createFakeOpsDb({
			temporalRows: requiredTemporalQueueRows().map((row) =>
				row.taskQueue === "campus-agent.activity.knowledge"
					? { ...row, oldestTaskAgeJson: { state: "unsupported_by_source" } }
					: row,
			),
		});
		const store = createPgOpsStatusStore({ db, now: () => now });

		const temporal = (await store.getOverview("1h")).temporal;

		expect(temporal.status).toBe("HEALTHY");
		expect(temporal.queues[3]).toMatchObject({
			dataState: "UNAVAILABLE",
			oldestTaskAgeMs: null,
			status: "UNKNOWN",
		});
	});

	it("degrades Temporal when a task age metric is malformed", async () => {
		const db = createFakeOpsDb({
			temporalRows: requiredTemporalQueueRows().map((row) =>
				row.taskQueue === "campus-agent.activity.knowledge"
					? { ...row, oldestTaskAgeJson: { ms: "not-a-number", state: "observed" } }
					: row,
			),
		});
		const store = createPgOpsStatusStore({ db, now: () => now });

		const temporal = (await store.getOverview("1h")).temporal;

		expect(temporal.status).toBe("DEGRADED");
		expect(temporal.queues[3]).toMatchObject({
			dataState: "UNAVAILABLE",
			oldestTaskAgeMs: null,
			status: "DEGRADED",
		});
	});

	it("degrades Temporal when task queue data is stale", async () => {
		const db = createFakeOpsDb({
			temporalRows: requiredTemporalQueueRows().map((row) => ({
				...row,
				projectedAt: new Date("2026-07-09T07:20:00.000Z"),
			})),
		});
		const store = createPgOpsStatusStore({ db, now: () => now });

		const temporal = (await store.getOverview("1h")).temporal;

		expect(temporal).toMatchObject({ dataState: "STALE", status: "DEGRADED" });
		expect(temporal.queues.every((queue) => queue.status === "DEGRADED")).toBe(true);
	});

	it("marks Temporal unavailable when a required queue has no worker", async () => {
		const db = createFakeOpsDb({
			temporalRows: requiredTemporalQueueRows().map((row) =>
				row.taskQueue === "campus-agent.activity.agent" ? { ...row, pollerCount: 0 } : row,
			),
		});
		const store = createPgOpsStatusStore({ db, now: () => now });

		const temporal = (await store.getOverview("1h")).temporal;

		expect(temporal.status).toBe("OUTAGE");
		expect(temporal.queues[2]).toMatchObject({
			pollerCount: 0,
			reason: "campus-agent.activity.agent 没有正在轮询的工作进程。",
			status: "OUTAGE",
		});
	});

	it("keeps request detail free of retired evidence fields", async () => {
		const store = createPgOpsStatusStore({ db: createFakeOpsDb(), now: () => now });
		const detail = OpsRequestDetailResponseSchema.parse(await store.getRequestDetail("req_pg_001"));

		expect(detail.request.runId).toBe("run_pg_001");
		expect(detail.correlationIds.workflowId).toBe("campus-agent.chat.run_pg_001");
		expect(detail.sources).toHaveLength(1);
		expect(detail.policySummary).toMatchObject({ aclDecision: "allowed", failClosed: false });
		expect(detail).not.toHaveProperty("externalEvidenceRefs");
		expect(detail).not.toHaveProperty("memorySummary");
		expect(detail).not.toHaveProperty("retrievalSummary");
		expect(detail.modelSummary).not.toHaveProperty("totalTokens");
		expect(detail.modelSummary).not.toHaveProperty("costUsd");
	});

	it("returns the selected request window with list results", async () => {
		const store = createPgOpsStatusStore({ db: createFakeOpsDb(), now: () => now });
		const result = await store.listRequests({ limit: 50, window: "1h" });

		expect(result.window).toBe("1h");
		expect(result.data).toHaveLength(1);
	});

	it("writes a raw observability read audit", async () => {
		const db = createFakeOpsDb({ temporalRows: requiredTemporalQueueRows() });
		const store = createPgOpsStatusStore({ db, now: () => now });
		await store.writeObservabilityReadAudit({
			kind: "logs",
			operatorId: "operator:v1:human:abc",
			operatorPrincipalClass: "human",
			readAt: now.toISOString(),
			recordCount: 1,
			requestId: "req_pg_001",
			traceId: "trace_pg_001",
			truncated: false,
		});

		expect(db.auditEvents).toHaveLength(1);
		expect(db.auditEvents[0]).toMatchObject({ kind: "logs", requestId: "req_pg_001" });
	});
});
