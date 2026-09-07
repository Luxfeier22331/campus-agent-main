// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	createOpsStatusStore,
	resolveCampusWebPublicOrigin,
} from "../src/server/ops-status/composition/factory.ts";
import { createPgOpsStatusStore } from "../src/server/ops-status/store/postgres.ts";
import {
	requestModelAttemptsSql,
	requestRowsCte,
	requestStagesSql,
} from "../src/server/ops-status/store/request-query.ts";
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
		const sql = `${requestRowsCte()}\n${requestStagesSql()}\n${requestModelAttemptsSql()}`;

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

	it("projects the product result and request-level execution diagnostics", async () => {
		const store = createPgOpsStatusStore({
			campusWebPublicOrigin: "https://campus.example.test",
			db: createFakeOpsDb(),
			now: () => now,
		});
		const detail = OpsRequestDetailResponseSchema.parse(await store.getRequestDetail("req_pg_001"));

		expect(detail.question).toEqual({ text: "缓考申请需要哪些材料？" });
		expect(detail.result).toMatchObject({
			kind: "answer",
			state: "WRITTEN",
			text: "缓考申请需提交书面材料。",
		});
		expect(detail.result.state === "WRITTEN" ? detail.result.sources : []).toHaveLength(1);
		expect(
			detail.result.state === "WRITTEN" ? detail.result.sources[0]?.primaryAction.href : null,
		).toBe(
			"https://campus.example.test/docs/regulations/student_rules/student-rules/v/2026#deferred-exam",
		);
		expect(detail.execution).toMatchObject({
			failure: {
				code: null,
				detail: null,
				httpStatus: null,
				invocationId: null,
				operation: null,
			},
			releases: {
				agentRuntime: "agent-runtime@899f251",
				executionControl: "execution-control@a77a046",
			},
		});
		expect(detail.execution.stages).toHaveLength(1);
		expect(detail.execution.stages[0]).toMatchObject({
			kind: "agent",
			status: "completed",
		});
		expect(detail.execution.model).toEqual({
			name: "deepseek-v4-flash-0731",
			provider: "openai-compatible",
			requestCount: 1,
			tokens: { cachedInput: 200, input: 1_200, output: 240, total: 1_440 },
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
				getRequestDiagnostics: async () => {
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
							href: "/docs/regulations/student_rules/student-rules/v/2026#status",
							label: "查看文档",
						},
						sectionTitle: "状态",
						snippet: null,
						title: "校园信息",
						versionSlug: "2026",
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
						versionSlug: "2026",
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
						versionSlug: "2026",
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
						versionSlug: "2026",
					},
					{
						citationIndexes: [5],
						kind: "campus_notice",
						noticeId: "354516",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: " /notices/354516 ",
							label: "查看通知",
						},
						sectionTitle: "正文",
						snippet: null,
						title: "有效通知",
					},
					{
						citationIndexes: [6],
						kind: "campus_notice",
						noticeId: "354517",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/notices/354516",
							label: "查看通知",
						},
						sectionTitle: "正文",
						snippet: null,
						title: "不一致通知",
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
		expect(detailWithOrigin.result.sources[4]?.primaryAction).toMatchObject({
			disabledReason: null,
			href: "/notices/354516",
		});
		expect(detailWithOrigin.result.sources[5]?.primaryAction).toMatchObject({
			disabledReason: "来源链接地址无效。",
			href: null,
		});
	});

	it("projects the complete Web source collection without requiring a Campus Web origin", async () => {
		const sourceItems = Array.from({ length: 6 }, (_, index) => ({
			citationIndexes: [index + 1],
			hostname: "www.muc.edu.cn",
			kind: "web_page",
			primaryAction: {
				disabledReason: null,
				external: true,
				href: `https://www.muc.edu.cn/page/${index + 1}?source=search#answer`,
				label: "打开网页",
			},
			snippet: null,
			title: `公开页面 ${index + 1}`,
		}));
		const request = requestRow({
			assistantStructuredPartsJson: [{ sourceItems, type: "source_items" }],
		});
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows: [request] }),
			now: () => now,
		});

		const detail = OpsRequestDetailResponseSchema.parse(
			await store.getRequestDetail(request.requestId),
		);
		if (detail.result.state !== "WRITTEN") {
			throw new Error("expected written result");
		}

		expect(detail.result.sources).toHaveLength(6);
		expect(detail.result.sources[5]).toMatchObject({
			citationIndexes: [6],
			hostname: "www.muc.edu.cn",
			kind: "web_page",
			primaryAction: {
				disabledReason: null,
				external: true,
				href: "https://www.muc.edu.cn/page/6?source=search#answer",
				label: "打开网页",
			},
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
						sanitizedPayloadJson: {
							agent_runtime_release: "agent-runtime@new",
							execution_control_release: "execution-control@old",
							failure: {
								code: "runtime_invariant_failed",
								http_status: 409,
								operation: "agent.primary",
							},
						},
						status: "failed",
						terminalReason: "runtime_invariant_failed",
						usageObserved: false,
					}),
				],
				steps: [
					runStepRow({
						sanitizedPayloadJson: {
							failure: { code: "runtime_invariant_failed", operation: "agent.primary" },
						},
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
			code: "runtime_invariant_failed",
			detail: null,
			httpStatus: 409,
			invocationId: null,
			operation: "agent.primary",
		});
		expect(detail?.execution.releases).toEqual({
			agentRuntime: "agent-runtime@new",
			executionControl: "execution-control@old",
		});
		expect(detail?.execution.model).toEqual({
			name: null,
			provider: null,
			requestCount: 0,
			tokens: { cachedInput: null, input: null, output: null, total: null },
		});
	});

	it("does not substitute product or closure codes for missing root failure evidence", async () => {
		const db = createFakeOpsDb({
			diagnostics: runDiagnostics({
				attempts: [
					runAttemptRow({
						failCloseReason: "workflow_failed_without_terminal_projection",
						sanitizedPayloadJson: {},
						status: "failed",
						terminalReason: "worker_unavailable",
					}),
				],
				steps: [
					runStepRow({
						sanitizedPayloadJson: {},
						status: "failed",
					}),
				],
			}),
			requestRows: [
				requestRow({
					errorCode: "run_failed",
					executionFailureKind: null,
					executionStepStatus: "failed",
					failCloseReason: "workflow_failed_without_terminal_projection",
					status: "error",
					terminalReason: "worker_unavailable",
				}),
			],
		});
		const detail = await createPgOpsStatusStore({ db, now: () => now }).getRequestDetail(
			"req_pg_001",
		);

		expect(detail?.execution.failure).toEqual({
			code: null,
			detail: null,
			httpStatus: null,
			invocationId: null,
			operation: null,
		});
		expect(detail?.execution).toMatchObject({
			failCloseReason: "workflow_failed_without_terminal_projection",
			terminalReason: "worker_unavailable",
		});
	});

	it("keeps a written answer completed when a later execution stage fails", async () => {
		const latestFailure = new Date("2026-07-09T07:29:10.000Z");
		const db = createFakeOpsDb({
			diagnostics: runDiagnostics({
				attempts: [
					runAttemptRow({
						sanitizedPayloadJson: {
							failure: { code: "agent_tool_failed", operation: "tool.call" },
						},
						status: "failed",
					}),
				],
				steps: [
					runStepRow({
						completedAt: latestFailure,
						sanitizedPayloadJson: {
							failure: { code: "hindsight_append_failed", operation: "memory.append" },
						},
						startedAt: new Date("2026-07-09T07:29:09.000Z"),
						status: "failed",
						stepId: "step_memory",
						stepKind: "memory",
						updatedAt: latestFailure,
					}),
					runStepRow({
						completedAt: new Date("2026-07-09T07:29:08.000Z"),
						sanitizedPayloadJson: {
							failure: { code: "agent_tool_failed", operation: "tool.call" },
						},
						startedAt: new Date("2026-07-09T07:29:07.000Z"),
						status: "failed",
						stepId: "step_tool",
						stepKind: "tool",
						updatedAt: new Date("2026-07-09T07:29:08.000Z"),
					}),
				],
			}),
			requestRows: [
				requestRow({
					attentionPriority: 1,
					attentionReason: "EXECUTION_STAGE_FAILED",
					completedAt: new Date("2026-07-09T07:29:04.000Z"),
					dataUpdatedAt: latestFailure,
					executionFailureKind: "hindsight_append_failed",
					executionStepKind: "memory",
					executionStepStatus: "failed",
					status: "completed",
				}),
			],
		});
		const store = createPgOpsStatusStore({ db, now: () => now });

		const detail = OpsRequestDetailResponseSchema.parse(await store.getRequestDetail("req_pg_001"));
		const attention = await store.listRequests({ view: "attention", window: "1h" });

		expect(detail.request).toMatchObject({ status: "COMPLETED", lifecyclePhase: "FINISHED" });
		expect(detail.result).toMatchObject({ state: "WRITTEN", kind: "answer" });
		expect(detail.execution.failure).toMatchObject({
			code: "hindsight_append_failed",
			operation: "memory.append",
		});
		expect(attention.data).toHaveLength(1);
		expect(attention.data[0]).toMatchObject({
			attentionReason: "EXECUTION_STAGE_FAILED",
			failureKind: "hindsight_append_failed",
			requestId: "req_pg_001",
			result: { kind: "answer", state: "WRITTEN" },
			status: "COMPLETED",
		});
		expect(attention.statusCounts).toMatchObject({ completed: 1, failed: 0, total: 1 });
	});

	it("does not load attempt diagnostics for request lists", async () => {
		const db = createFakeOpsDb({
			requestRows: [requestRow(), requestRow({ requestId: "req_pg_without_diagnostics" })],
		});
		const getRequestDiagnostics = vi.fn(async () => {
			throw new Error("list must not load diagnostics");
		});
		const store = createPgOpsStatusStore({
			db: { ...db, getRequestDiagnostics },
			now: () => now,
		});

		const result = await store.listRequests({ window: "1h" });

		expect(result.data).toHaveLength(2);
		expect(result.data.find((request) => request.requestId === "req_pg_001")).toMatchObject({
			executionStage: { kind: "agent", status: "completed" },
			requestId: "req_pg_001",
		});
		expect(getRequestDiagnostics).not.toHaveBeenCalled();
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

	it("filters exact request IDs", async () => {
		const target = requestRow({ requestId: "req_target" });
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows: [requestRow(), target] }),
			now: () => now,
		});

		const result = await store.listRequests({ requestId: "req_target", window: "1h" });

		expect(result.data).toHaveLength(1);
		expect(result.data[0]).toMatchObject({ requestId: "req_target" });
	});

	it("filters request lists by execution failure kind", async () => {
		const request = requestRow({
			attentionPriority: 1,
			attentionReason: "EXECUTION_STAGE_FAILED",
			executionFailureKind: "hindsight_append_failed",
			requestId: "req_memory_failure",
			status: "completed",
		});
		const store = createPgOpsStatusStore({
			db: createFakeOpsDb({ requestRows: [requestRow(), request] }),
			now: () => now,
		});

		const result = await store.listRequests({ q: "hindsight_append_failed", window: "1h" });

		expect(result.data.map((row) => row.requestId)).toEqual(["req_memory_failure"]);
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
