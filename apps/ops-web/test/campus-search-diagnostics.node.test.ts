import { describe, expect, it } from "vitest";
import { toCampusSearchDiagnostics } from "../src/server/ops-status/mapping/campus-search.ts";
import {
	createPgOpsStatusStore,
	createPgOpsStatusStoreDatabase,
} from "../src/server/ops-status/store/postgres.ts";
import type { CampusSearchDiagnosticRow } from "../src/server/ops-status/store/types.ts";
import { CampusSearchDiagnosticsSchema } from "../src/shared/campus-search-diagnostics.ts";
import { requestRow } from "./ops-status-store-test-helpers.ts";

function campusSearchRow(): CampusSearchDiagnosticRow {
	return {
		invocationId: "call",
		workflowStepId: "step",
		activityAttempt: 1,
		schemaVersion: 1,
		searchQuery: "图书馆",
		status: "completed",
		currentPhase: "completed",
		phaseTimes: {
			queued: "2026-09-08T00:00:00Z",
			dispatching: "2026-09-08T00:00:01Z",
			selected: "2026-09-08T00:00:02Z",
			completed: "2026-09-08T00:00:03Z",
		},
		failureCode: null,
		httpStatus: null,
		citedResultRefs: ["result://one"],
		updatedAt: new Date("2026-09-08T00:00:04Z"),
		snapshot: {
			effectiveQuery: "图书馆",
			citationStart: 1,
			resultLimit: 5,
			retrievalMode: "hybrid_rrf",
			durations: { embedding: 50, retrieval: 40, rerank: 60, selection: 0 },
			retrievedCount: 1,
			deduplicatedCount: 1,
			rerankInputCount: 1,
			rerankKeptCount: 1,
			returnedCount: 1,
			excludedCount: 0,
			snapshotTruncated: false,
			candidates: [
				{
					resultRef: "result://one",
					sourceKind: "document",
					title: "图书馆",
					section: "借阅",
					fusionScore: 0.2,
					rerankScore: 0.9,
					retrievalRank: 1,
					rerankRank: 1,
					returned: true,
					text: "借阅规则",
					citationIndex: 1,
				},
			],
		},
	};
}

describe("campus search diagnostics", () => {
	it("maps timing, actual candidates and citation use", () => {
		const diagnostic = toCampusSearchDiagnostics([campusSearchRow()], true);
		expect(CampusSearchDiagnosticsSchema.parse(diagnostic)).toEqual(diagnostic);
		expect(diagnostic).toMatchObject({
			dataState: "FRESH",
			calls: [
				{
					queueMs: 1000,
					toolTotalMs: 2000,
					snapshot: { candidates: [{ cited: true, text: "借阅规则" }] },
				},
			],
		});
	});
	it("keeps no data, query failures and incomplete calls distinct", () => {
		expect(toCampusSearchDiagnostics([], true).dataState).toBe("NO_DATA");
		expect(toCampusSearchDiagnostics(null, true).dataState).toBe("UNAVAILABLE");
		const row = campusSearchRow();
		row.status = "running";
		row.citedResultRefs = null;
		expect(toCampusSearchDiagnostics([row], true)).toMatchObject({
			dataState: "PARTIAL",
			calls: [{ status: "incomplete", snapshot: { candidates: [{ cited: null }] } }],
		});
	});
	it("does not report a missing snapshot as zero retrieved candidates", () => {
		const row = campusSearchRow();
		row.snapshot = {};
		expect(toCampusSearchDiagnostics([row], true)).toMatchObject({
			dataState: "PARTIAL",
			calls: [{ snapshot: null }],
		});
	});
	it("does not let a failed Campus query hide the product result", async () => {
		const db = createPgOpsStatusStoreDatabase({
			query: async (sql: string) => {
				if (sql.includes("agent_campus_search_diagnostics")) {
					throw new Error("table unavailable");
				}
				if (
					sql.includes("agent_step_attempts") ||
					sql.includes("from execution_control.agent_run_steps")
				) {
					return { rows: [] };
				}
				return { rows: [requestRow()] };
			},
		} as Parameters<typeof createPgOpsStatusStoreDatabase>[0]);
		const diagnostic = await db.getRequestDiagnostics("request-one");
		expect(diagnostic.campusSearch).toBeNull();
		const store = createPgOpsStatusStore({
			db: {
				...db,
				getRequest: async () => requestRow(),
				getRequestDiagnostics: async () => ({ ...diagnostic, stages: [], modelAttempts: [] }),
			},
		});
		const detail = await store.getRequestDetail("request-one");
		expect(detail?.result.state).toBe("WRITTEN");
		expect(detail?.execution.campusSearch.dataState).toBe("UNAVAILABLE");
	});
});
