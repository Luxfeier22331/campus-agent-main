// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	createOpsStatusStore,
	resolveCampusWebPublicOrigin,
} from "../src/server/ops-status-factory";
import { createPgOpsStatusStore } from "../src/server/pg-ops-status-store";
import { requestRowsCte, runAttemptsSql, runStepsSql } from "../src/server/pg-request-query";
import { OpsRequestDetailResponseSchema } from "../src/shared/ops-contract";
import {
	createFakeOpsDb,
	requestRow,
	runAttemptRow,
	runDiagnostics,
	runStepRow,
} from "./ops-status-store-test-helpers";

const now = new Date("2026-07-09T07:30:00.000Z");

describe("PostgreSQL ops status store", () => {
	it("uses the application-owned database pool", async () => {
		const query = vi.fn(async () => ({ rows: [] }));
		const store = createOpsStatusStore({ pool: { query } as never });

		await store.verifyReadiness();

		expect(query).toHaveBeenCalledWith("select 1");
	});

	it("accepts only canonical trusted Campus Web origins", () => {
		expect(resolveCampusWebPublicOrigin("https://campus.example.test")).toBe(
			"https://campus.example.test",
		);
		expect(resolveCampusWebPublicOrigin("https://campus.example.test/")).toBe(
			"https://campus.example.test",
		);
		expect(resolveCampusWebPublicOrigin("http://127.0.0.1:5183")).toBe("http://127.0.0.1:5183");
		expect(resolveCampusWebPublicOrigin("https://campus.example.test/path")).toBeUndefined();
		expect(resolveCampusWebPublicOrigin("http://campus.example.test")).toBeUndefined();
		expect(resolveCampusWebPublicOrigin("https://user:pass@campus.example.test")).toBeUndefined();
	});

	it("separates startup schema verification from periodic readiness", async () => {
		const db = createFakeOpsDb();
		db.verifyReadiness = vi.fn(async () => undefined);
		db.verifySchema = vi.fn(async () => undefined);
		const store = createPgOpsStatusStore({ db, now: () => now });

		await store.verifyReadiness();
		expect(db.verifyReadiness).toHaveBeenCalledOnce();
		expect(db.verifySchema).not.toHaveBeenCalled();

		await store.verifySchema();
		expect(db.verifySchema).toHaveBeenCalledOnce();
	});

	it("reads execution projections from the owning schema", () => {
		const sql = `${requestRowsCte()}\n${runStepsSql()}\n${runAttemptsSql()}`;

		expect(sql).toContain('"execution_control"."agent_runs"');
		expect(sql).toContain('"execution_control"."agent_run_steps"');
		expect(sql).toContain('"execution_control"."agent_step_attempts"');
		expect(sql).not.toContain('"runtime"."agent_runs"');
		expect(sql).not.toContain('"runtime"."agent_run_steps"');
		expect(sql).not.toContain('"runtime"."agent_step_attempts"');
	});

	it("builds windowed request overview data", async () => {
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb(),
			now: () => now,
		});
		const overview = await store.getOverview("1h");

		expect(overview.requests).toMatchObject({
			completed: 1,
			dataState: "FRESH",
			status: "HEALTHY",
			total: 1,
		});
		expect(overview.trends).toMatchObject({ dataState: "FRESH" });
		expect(overview.trends.data).toHaveLength(1);
	});

	it("represents a quiet request window as no data instead of stale", async () => {
		const db = createFakeOpsDb({
			requestRows: [
				requestRow({
					dataUpdatedAt: new Date("2026-07-08T07:29:05.000Z"),
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

	it("keeps request overview visible when trends fail", async () => {
		const db = {
			...createFakeOpsDb(),
			getRequestTrends: async () => {
				throw new Error("request trends unavailable");
			},
		};
		const store = createPgOpsStatusStore({
			db,
			now: () => now,
		});

		const overview = await store.getOverview("1h");

		expect(overview.requests).toMatchObject({ dataState: "FRESH", status: "HEALTHY" });
		expect(overview.trends).toEqual({
			data: [],
			dataState: "UNAVAILABLE",
			reason: "请求趋势查询不可用。",
		});
	});

	it("projects the conversation result, execution diagnostics, and technical context", async () => {
		const store = createPgOpsStatusStore({
			campusWebPublicOrigin: "https://campus.example.test",
			db: createFakeOpsDb(),
			now: () => now,
		});
		const detail = OpsRequestDetailResponseSchema.parse(await store.getRequestDetail("req_pg_001"));

		expect(detail.question).toEqual({ text: "缓考申请需要哪些材料？", turnSequence: 3 });
		expect(detail.result).toMatchObject({
			kind: "answer",
			state: "WRITTEN",
			text: "缓考申请需提交书面材料。",
		});
		expect(detail.result.state === "WRITTEN" ? detail.result.sources : []).toHaveLength(1);
		expect(
			detail.result.state === "WRITTEN" ? detail.result.sources[0]?.primaryAction.href : null,
		).toBe(
			"https://campus.example.test/docs/regulations/student_rules/student-rules/v/2026-current#deferred-exam",
		);
		expect(detail.execution).toMatchObject({
			failure: {
				agentRuntimeHttpStatus: null,
				kind: null,
				runtimeErrorCode: null,
			},
			releases: {
				agentRuntime: "agent-runtime@899f251",
				executionControl: "execution-control@a77a046",
			},
		});
		expect(detail.execution.steps).toHaveLength(1);
		expect(detail.execution.steps[0]).toMatchObject({
			kind: "agent",
			status: "completed",
			stepId: "agent.primary",
		});
		expect(detail.execution.steps[0]?.attempts[0]).toMatchObject({
			modelName: "deepseek-v4-flash-0731",
			modelProvider: "openai-compatible",
			modelRequestCount: 1,
			tokens: { cachedInput: 200, input: 1_200, output: 240 },
		});
		expect(detail.technical.correlationIds).toMatchObject({
			runId: "run_pg_001",
			workflowId: "campus-agent.chat.run_pg_001",
		});
		expect(detail.technical.runtimeVersions).toEqual({
			agentRuntime: "openai_agents_sdk",
		});
		expect(detail).not.toHaveProperty("externalEvidenceRefs");
		expect(detail).not.toHaveProperty("journey");
		expect(detail).not.toHaveProperty("usage");
		expect(detail).not.toHaveProperty("memorySummary");
		expect(detail).not.toHaveProperty("modelSummary");
		expect(detail).not.toHaveProperty("policySummary");
		expect(detail).not.toHaveProperty("retrievalSummary");
	});

	it("does not hide a durable diagnostics query failure", async () => {
		const diagnosticsUnavailable = createPgOpsStatusStore({
			db: {
				...createFakeOpsDb(),
				getRunDiagnostics: async () => {
					throw new Error("diagnostics unavailable");
				},
			},
			now: () => now,
		});
		await expect(diagnosticsUnavailable.getRequestDetail("req_pg_001")).rejects.toThrow(
			"diagnostics unavailable",
		);
	});

	it("does not emit unsafe or unresolved product source links", async () => {
		const sourceParts = [
			{
				sourceItems: [
					{
						citationIndexes: [1],
						collectionLabel: "校园服务",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/docs/regulations/student_rules/student-rules/v/2026-current#status",
							label: "查看文档",
						},
						sectionTitle: "状态",
						snippet: null,
						title: "校园信息",
						versionLabel: "当前",
					},
					{
						citationIndexes: [2],
						collectionLabel: "错误来源",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "javascript:alert(1)",
							label: "查看文档",
						},
						sectionTitle: "正文",
						snippet: null,
						title: "错误页面",
						versionLabel: "当前",
					},
					{
						citationIndexes: [3],
						collectionLabel: "明文来源",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "http://source.example.test/page",
							label: "查看文档",
						},
						sectionTitle: "正文",
						snippet: null,
						title: "明文页面",
						versionLabel: "当前",
					},
					{
						citationIndexes: [4],
						collectionLabel: "协议来源",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "//source.example.test/page",
							label: "查看文档",
						},
						sectionTitle: "正文",
						snippet: null,
						title: "协议页面",
						versionLabel: "当前",
					},
				],
				type: "source_items",
			},
		];
		const request = requestRow({ assistantStructuredPartsJson: sourceParts });
		const noOrigin = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows: [request] }),
			now: () => now,
		});
		const detail = OpsRequestDetailResponseSchema.parse(
			await noOrigin.getRequestDetail(request.requestId),
		);
		if (detail.result.state !== "WRITTEN") {
			throw new Error("expected written result");
		}
		expect(detail.result.sources[0]?.primaryAction).toMatchObject({
			disabledReason: "Campus Web 地址未配置。",
			href: null,
		});

		const withOrigin = createPgOpsStatusStore({
			campusWebPublicOrigin: "https://campus.example.test",
			db: createFakeOpsDb({ requestRows: [request] }),
			now: () => now,
		});
		const detailWithOrigin = OpsRequestDetailResponseSchema.parse(
			await withOrigin.getRequestDetail(request.requestId),
		);
		if (detailWithOrigin.result.state !== "WRITTEN") {
			throw new Error("expected written result");
		}
		expect(detailWithOrigin.result.sources[1]?.primaryAction).toMatchObject({
			disabledReason: "来源链接地址无效。",
			href: null,
		});
		expect(detailWithOrigin.result.sources[2]?.primaryAction).toMatchObject({
			disabledReason: "来源链接地址无效。",
			href: null,
		});
		expect(detailWithOrigin.result.sources[3]?.primaryAction).toMatchObject({
			disabledReason: "来源链接地址无效。",
			href: null,
		});
	});

	it("projects attempt-level failures without inventing model activity", async () => {
		const db = createFakeOpsDb({
			diagnostics: runDiagnostics({
				attempts: [
					runAttemptRow({
						failCloseReason: "tool_contract_mismatch",
						modelName: "",
						modelProvider: "",
						modelRequestCount: 0,
						providerResponseId: "",
						sanitizedPayloadJson: {
							agent_runtime_error_code: "tool_contract_mismatch",
							agent_runtime_http_status: 409,
							agent_runtime_release: "agent-runtime@new",
							execution_control_release: "execution-control@old",
							failure_kind: "runtime_invariant_failed",
						},
						status: "failed",
						terminalReason: "runtime_invariant_failed",
						usageObserved: false,
					}),
				],
				steps: [
					runStepRow({
						sanitizedPayloadJson: { failure_kind: "runtime_invariant_failed" },
						status: "failed",
					}),
				],
			}),
			requestRows: [
				requestRow({
					assistantKind: "error",
					errorCode: "runtime_invariant_failed",
					executionFailureKind: "runtime_invariant_failed",
					executionStepStatus: "failed",
					failCloseReason: "tool_contract_mismatch",
					status: "error",
					terminalReason: "runtime_invariant_failed",
				}),
			],
		});
		const detail = await createPgOpsStatusStore({ db, now: () => now }).getRequestDetail(
			"req_pg_001",
		);

		expect(detail?.execution.failure).toEqual({
			agentRuntimeHttpStatus: 409,
			failCloseReason: "tool_contract_mismatch",
			kind: "runtime_invariant_failed",
			runtimeErrorCode: "tool_contract_mismatch",
			terminalReason: "runtime_invariant_failed",
		});
		expect(detail?.execution.releases).toEqual({
			agentRuntime: "agent-runtime@new",
			executionControl: "execution-control@old",
		});
		expect(detail?.execution.steps[0]?.attempts[0]).toMatchObject({
			modelName: null,
			modelProvider: null,
			modelRequestCount: 0,
			providerResponseId: null,
			tokens: { cachedInput: null, input: null, output: null },
		});
	});

	it("does not load attempt diagnostics for request lists", async () => {
		const db = createFakeOpsDb({
			requestRows: [
				requestRow(),
				requestRow({ requestId: "req_pg_without_run", runId: null, workflowId: null }),
			],
		});
		const getRunDiagnostics = vi.fn(async () => {
			throw new Error("list must not load diagnostics");
		});
		const store = createPgOpsStatusStore({
			db: { ...db, getRunDiagnostics },
			now: () => now,
		});

		const result = await store.listRequests({ window: "1h" });

		expect(result.data).toHaveLength(2);
		expect(result.data.find((request) => request.requestId === "req_pg_001")).toMatchObject({
			executionStage: { kind: "agent", status: "completed", stepId: "agent.primary" },
			requestId: "req_pg_001",
		});
		expect(getRunDiagnostics).not.toHaveBeenCalled();
	});

	it("returns the selected request window with list results", async () => {
		const store = createPgOpsStatusStore({ db: createFakeOpsDb(), now: () => now });
		const result = await store.listRequests({ window: "1h" });

		expect(result.window).toBe("1h");
		expect(result.data).toHaveLength(1);
	});

	it("uses a fixed fifty-row page and emits a forward cursor", async () => {
		const requestRows = Array.from({ length: 51 }, (_, index) =>
			requestRow({
				requestId: `req_pg_${String(index).padStart(3, "0")}`,
				startedAt: new Date(now.valueOf() - index * 1_000),
			}),
		);
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows }),
			now: () => now,
		});

		const result = await store.listRequests({ window: "1h" });

		expect(result.data).toHaveLength(50);
		expect(result.data.at(-1)?.requestId).toBe("req_pg_049");
		expect(result.page.nextCursor).toBeTypeOf("string");
		expect(result.statusCounts.total).toBe(51);
	});

	it("keeps status facets scoped to non-status filters", async () => {
		const requestRows = [
			requestRow({ questionPreview: "same query", requestId: "req_completed" }),
			requestRow({
				completedAt: new Date("2026-07-09T07:29:04.000Z"),
				errorCode: "MODEL_PROVIDER_TIMEOUT",
				questionPreview: "same query",
				requestId: "req_failed",
				status: "error",
				terminalReason: "provider_unavailable",
			}),
			requestRow({ questionPreview: "different query", requestId: "req_other" }),
		];
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows }),
			now: () => now,
		});

		const result = await store.listRequests({ q: "same query", status: "FAILED", window: "1h" });

		expect(result.data.map((request) => request.requestId)).toEqual(["req_failed"]);
		expect(result.statusCounts).toEqual({
			actionRequired: 0,
			cancelled: 0,
			completed: 1,
			failed: 1,
			pending: 0,
			running: 0,
			total: 2,
		});
	});

	it("filters exact run and workflow IDs and projects their real values", async () => {
		const target = requestRow({
			requestId: "req_target",
			runId: "run_exact",
			workflowId: "workflow/exact",
		});
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows: [requestRow(), target] }),
			now: () => now,
		});

		const byRun = await store.listRequests({ runId: "run_exact", window: "1h" });
		const byWorkflow = await store.listRequests({ workflowId: "workflow/exact", window: "1h" });

		expect(byRun.data).toHaveLength(1);
		expect(byWorkflow.data).toHaveLength(1);
		expect(byWorkflow.data[0]).toMatchObject({ requestId: "req_target" });
		expect(byWorkflow.data[0]).not.toHaveProperty("runId");
		const detail = await store.getRequestDetail("req_target");
		expect(detail?.technical.correlationIds).toMatchObject({
			runId: "run_exact",
			workflowId: "workflow/exact",
		});
	});

	it("keeps recent runs chronological and prioritizes missing results in attention view", async () => {
		const requestRows = [
			requestRow({
				completedAt: null,
				requestId: "req_running",
				runStatus: "running",
				startedAt: new Date("2026-07-09T07:29:50.000Z"),
				status: "running",
			}),
			requestRow({
				attentionPriority: 1,
				attentionReason: "REQUEST_FAILED",
				errorCode: "MODEL_PROVIDER_TIMEOUT",
				requestId: "req_failed",
				startedAt: new Date("2026-07-09T07:29:20.000Z"),
				status: "error",
			}),
			requestRow({
				attentionPriority: 2,
				attentionReason: "WAITING_USER",
				assistantKind: "error",
				requestId: "req_waiting_user",
				startedAt: new Date("2026-07-09T07:29:40.000Z"),
				status: "approval_required",
			}),
			requestRow({
				assistantKind: null,
				assistantMessagePresent: false,
				assistantMessageText: null,
				attentionPriority: 0,
				attentionReason: "RESULT_MISSING",
				requestId: "req_missing",
				startedAt: new Date("2026-07-09T07:29:10.000Z"),
			}),
		];
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows }),
			now: () => now,
		});

		const recent = await store.listRequests({ view: "recent", window: "1h" });
		const attention = await store.listRequests({ view: "attention", window: "1h" });

		expect(recent.data.map((request) => request.requestId)).toEqual([
			"req_running",
			"req_waiting_user",
			"req_failed",
			"req_missing",
		]);
		expect(attention.data.map((request) => request.requestId)).toEqual([
			"req_missing",
			"req_failed",
			"req_waiting_user",
		]);
		expect(attention.statusCounts).toMatchObject({
			actionRequired: 1,
			completed: 1,
			failed: 1,
			total: 3,
		});
	});

	it("derives lifecycle phases from dispatch and agent run facts", async () => {
		const requestRows = [
			requestRow({
				completedAt: null,
				requestId: "req_waiting",
				runStatus: null,
				status: "accepted",
			}),
			requestRow({
				completedAt: null,
				requestId: "req_streaming",
				runStatus: "streaming",
				status: "running",
			}),
			requestRow({
				completedAt: null,
				requestId: "req_finalizing",
				runStatus: "completed",
				status: "running",
			}),
		];
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows }),
			now: () => now,
		});

		const result = await store.listRequests({ window: "1h" });

		expect(
			result.data.map(({ lifecyclePhase, requestId }) => ({ lifecyclePhase, requestId })),
		).toEqual(
			expect.arrayContaining([
				{ lifecyclePhase: "STREAMING", requestId: "req_streaming" },
				{ lifecyclePhase: "QUEUED", requestId: "req_waiting" },
				{ lifecyclePhase: "FINALIZING", requestId: "req_finalizing" },
			]),
		);
	});
});
