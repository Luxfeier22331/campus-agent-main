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
		schemaVersion: 2,
		searchQuery: "图书馆",
		status: "completed",
		currentPhase: "completed",
		phaseTimes: {
			queued: "2026-09-08T00:00:00Z",
			dispatching: "2026-09-08T00:00:01Z",
			received: "2026-09-08T00:00:01.100Z",
			index_loaded: "2026-09-08T00:00:01.200Z",
			embedded: "2026-09-08T00:00:01.300Z",
			retrieved: "2026-09-08T00:00:01.400Z",
			reranked: "2026-09-08T00:00:01.500Z",
			selected: "2026-09-08T00:00:02Z",
			completed: "2026-09-08T00:00:03Z",
		},
		failureCode: null,
		httpStatus: null,
		citedResultRefs: ["result://one"],
		updatedAt: new Date("2026-09-08T00:00:04Z"),
		snapshot: {
			effectiveQuery: "图书馆",
			rerankQuery: "怎样办理借阅手续？",
			citationStart: 1,
			resultLimit: 5,
			retrievalMode: "hybrid_rrf",
			durations: { embedding: 50, retrieval: 40, rerank: 60, selection: 0 },
			retrievedCount: 1,
			deduplicatedCount: 1,
			rerankInputCount: 1,
			rerankKeptCount: 1,
			sourceGroupedCount: 1,
			sourceGroupedExcludedCount: 0,
			embedding: {
				provider: "compatible",
				model: "embedding",
				serviceOrigin: "http://provider",
				dimensions: 2560,
				instructionVersion: "campus-query.v1",
				cacheOutcome: "hit",
			},
			retrieval: {
				collection: "collection",
				httpMs: 35,
				qdrantMs: null,
				decodeMs: 2,
				postprocessMs: 3,
			},
			rerank: { provider: "compatible", model: "reranker", httpMs: 60, inputCount: 1 },
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
	it("preserves a failed retrieval and upstream status after the answer finishes", () => {
		const row = campusSearchRow();
		row.status = "failed";
		row.currentPhase = "failed";
		row.failureCode = "campus_search_retrieval_failed";
		row.httpStatus = 503;
		row.phaseTimes = { queued: "2026-09-30T00:00:00Z", failed: "2026-09-30T00:00:01Z" };
		row.snapshot = {
			...(row.snapshot as Record<string, unknown>),
			failedStage: "retrieval",
			failureDetail: 'campus notice Qdrant payload schema "campus_rag_point.v999" is unsupported',
			retrieval: {
				collection: "collection",
				httpStatus: 200,
				httpMs: 1,
				qdrantMs: 0,
				decodeMs: 0,
				postprocessMs: null,
			},
		};
		expect(
			CampusSearchDiagnosticsSchema.parse(toCampusSearchDiagnostics([row], true)).calls[0],
		).toMatchObject({
			status: "failed",
			httpStatus: 503,
			snapshot: {
				failedStage: "retrieval",
				failureDetail: 'campus notice Qdrant payload schema "campus_rag_point.v999" is unsupported',
				retrieval: { httpStatus: 200 },
			},
		});
	});
	it("rejects retired snapshots and preserves v2 metadata", () => {
		const retired = { ...campusSearchRow(), schemaVersion: 1 };
		expect(toCampusSearchDiagnostics([retired], true)).toMatchObject({
			diagnosticState: "PARTIAL",
			calls: [{ snapshot: null }],
		});
		const row = campusSearchRow();
		row.snapshot = {
			...(row.snapshot as Record<string, unknown>),
			rerankQuery: "怎样办理借阅手续？",
		};
		const current = toCampusSearchDiagnostics([row], true);
		expect(CampusSearchDiagnosticsSchema.parse(current).calls[0]?.snapshot).toMatchObject({
			effectiveQuery: "图书馆",
			rerankQuery: "怎样办理借阅手续？",
			embedding: { model: "embedding", cacheOutcome: "hit", serviceOrigin: "http://provider" },
			retrieval: {
				collection: "collection",
				httpMs: 35,
				qdrantMs: null,
				decodeMs: 2,
				postprocessMs: 3,
			},
			rerank: { model: "reranker", httpMs: 60 },
		});
	});
	it("maps timing, actual candidates and citation use", () => {
		const diagnostic = toCampusSearchDiagnostics([campusSearchRow()], true);
		expect(CampusSearchDiagnosticsSchema.parse(diagnostic)).toEqual(diagnostic);
		expect(diagnostic).toMatchObject({
			diagnosticState: "COMPLETE",
			calls: [
				{
					queueMs: 1000,
					toolTotalMs: 2000,
					citedCount: 1,
					snapshot: { candidates: [{ cited: true, text: "借阅规则" }] },
				},
			],
		});
	});
	it("marks a cited stable source in each call regardless of its citation index", () => {
		const first = campusSearchRow();
		const second = campusSearchRow();
		second.invocationId = "second-call";
		const snapshot = second.snapshot as Record<string, unknown>;
		snapshot.citationStart = 5;
		const candidates = snapshot.candidates as Record<string, unknown>[];
		snapshot.candidates = [
			{ ...candidates[0], citationIndex: 5 },
			{ ...candidates[0], resultRef: "result://unused", citationIndex: 6 },
		];
		const diagnostics = toCampusSearchDiagnostics([first, second], true);
		expect(diagnostics.calls).toMatchObject([
			{ citedCount: 1, snapshot: { candidates: [{ citationIndex: 1, cited: true }] } },
			{
				citedCount: 1,
				snapshot: {
					candidates: [
						{ citationIndex: 5, cited: true },
						{ citationIndex: 6, cited: false },
					],
				},
			},
		]);
	});
	it("preserves measured zero, but marks missing timing and truncated snapshots partial", () => {
		const row = campusSearchRow();
		const snapshot = row.snapshot as Record<string, unknown>;
		const retrieval: {
			collection: string;
			httpMs: number | null;
			qdrantMs: number;
			decodeMs: number;
			postprocessMs: number;
		} = { collection: "c", httpMs: 0, qdrantMs: 0, decodeMs: 0, postprocessMs: 0 };
		snapshot.retrieval = retrieval;
		expect(toCampusSearchDiagnostics([row], true).diagnosticState).toBe("COMPLETE");
		retrieval.httpMs = null;
		expect(toCampusSearchDiagnostics([row], true).diagnosticState).toBe("PARTIAL");
		retrieval.httpMs = 0;
		snapshot.snapshotTruncated = true;
		expect(toCampusSearchDiagnostics([row], true).diagnosticState).toBe("PARTIAL");
	});
	it("allows empty retrieval without inventing a rerank phase", () => {
		const row = campusSearchRow();
		const snapshot = row.snapshot as Record<string, unknown>;
		snapshot.retrievedCount = 0;
		snapshot.candidates = [];
		delete snapshot.rerank;
		delete row.phaseTimes.reranked;
		row.citedResultRefs = [];
		expect(toCampusSearchDiagnostics([row], true)).toMatchObject({
			diagnosticState: "COMPLETE",
			calls: [{ citedCount: 0 }],
		});
	});
	it("does not require unexecuted stages on failure, or call an empty failure snapshot complete", () => {
		const row = campusSearchRow();
		row.status = "failed";
		row.currentPhase = "failed";
		row.phaseTimes = { queued: "2026-09-08T00:00:00Z", failed: "2026-09-08T00:00:03Z" };
		row.citedResultRefs = null;
		const snapshot = row.snapshot as Record<string, unknown>;
		snapshot.failedStage = "index";
		delete snapshot.embedding;
		delete snapshot.retrieval;
		delete snapshot.rerank;
		expect(toCampusSearchDiagnostics([row], true).diagnosticState).toBe("COMPLETE");
		row.snapshot = null;
		expect(toCampusSearchDiagnostics([row], true).diagnosticState).toBe("PARTIAL");
	});
	it("keeps no data, query failures and incomplete calls distinct", () => {
		expect(toCampusSearchDiagnostics([], true).diagnosticState).toBe("NO_DATA");
		expect(toCampusSearchDiagnostics(null, true).diagnosticState).toBe("UNAVAILABLE");
		const row = campusSearchRow();
		row.status = "running";
		row.citedResultRefs = null;
		expect(toCampusSearchDiagnostics([row], true)).toMatchObject({
			diagnosticState: "PARTIAL",
			calls: [{ status: "incomplete", snapshot: { candidates: [{ cited: null }] } }],
		});
	});
	it("does not report a missing snapshot as zero retrieved candidates", () => {
		const row = campusSearchRow();
		row.snapshot = {};
		expect(toCampusSearchDiagnostics([row], true)).toMatchObject({
			diagnosticState: "PARTIAL",
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
					sql.includes("from agent_control.agent_run_steps")
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
		expect(detail?.execution.campusSearch.diagnosticState).toBe("UNAVAILABLE");
	});
});
