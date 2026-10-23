import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CampusSearchSection } from "../src/app/campus-search-diagnostics";
import { requestDetailPollInterval } from "../src/app/request-detail-page";
import { toCampusSearchDiagnostics } from "../src/server/ops-status/mapping/campus-search";
import type { CampusSearchDiagnostics } from "../src/shared/campus-search-diagnostics";
import type { OpsRequestDetailResponse } from "../src/shared/ops-contract";

describe("Campus Search Ops display", () => {
	it("shows actual configuration, source grouping, citations and nullable timings", () => {
		const diagnostics: CampusSearchDiagnostics = {
			diagnosticState: "COMPLETE",
			reason: null,
			calls: [
				{
					invocationId: "call",
					workflowStepId: "step",
					activityAttempt: 1,
					searchQuery: "借购数量",
					status: "completed",
					currentPhase: "completed",
					phaseTimes: {
						retrieved: "2026-09-11T00:00:00Z",
						reranked: "2026-09-11T00:00:01Z",
						selected: "2026-09-11T00:00:02Z",
					},
					queueMs: 0,
					toolTotalMs: 2000,
					failureCode: null,
					httpStatus: null,
					citedCount: 1,
					updatedAt: "2026-09-11T00:00:03Z",
					snapshot: {
						effectiveQuery: "借购数量",
						rerankQuery: "一次能借几本？",
						citationStart: 1,
						resultLimit: 5,
						retrievalMode: "hybrid_rrf",
						durations: { embedding: 0, retrieval: 1000, rerank: 900, selection: 0 },
						retrievedCount: 2,
						deduplicatedCount: 2,
						rerankInputCount: 2,
						rerankKeptCount: 2,
						sourceGroupedCount: 1,
						sourceGroupedExcludedCount: 1,
						returnedCount: 1,
						excludedCount: 1,
						snapshotTruncated: false,
						embedding: {
							provider: "compatible",
							model: "actual-embedding",
							serviceOrigin: "https://embedding.example",
							dimensions: 2560,
							instructionVersion: "campus-query.v1",
							cacheOutcome: "hit",
						},
						retrieval: {
							collection: "actual_collection",
							httpMs: 900,
							qdrantMs: null,
							decodeMs: 0,
							postprocessMs: 0,
						},
						rerank: {
							provider: "compatible",
							model: "actual-reranker",
							inputCount: 2,
							httpMs: 890,
						},
						candidates: [
							{
								resultRef: "result://one",
								sourceKind: "notice",
								noticeId: "1",
								title: "通知",
								section: "正文",
								fusionScore: 0.1,
								rerankScore: 0.9,
								retrievalRank: 1,
								rerankRank: 1,
								returned: true,
								text: "借购四本",
								citationIndex: 1,
								cited: true,
							},
							{
								resultRef: "result://two",
								sourceKind: "notice",
								noticeId: "1",
								title: "通知",
								section: "登录",
								fusionScore: 0.09,
								rerankScore: 0.8,
								retrievalRank: 2,
								rerankRank: 2,
								returned: false,
								text: "登录说明",
								citationIndex: null,
								cited: false,
								exclusionReason: "same_notice_cap",
							},
						],
					},
				},
			],
		};
		render(<CampusSearchSection diagnostics={diagnostics} />);
		expect(screen.getByText(/诊断完整/)).toBeInTheDocument();
		expect(screen.queryByText(/FRESH/)).not.toBeInTheDocument();
		expect(screen.getByText(/actual-embedding/)).toBeInTheDocument();
		expect(screen.getByText(/actual-reranker/)).toBeInTheDocument();
		expect(screen.getByText(/actual_collection/)).toBeInTheDocument();
		expect(screen.getByText(/Qdrant 服务端 未记录.*解码 0 ms/)).toBeInTheDocument();
		expect(screen.getByText(/同来源排除 1.*返回模型 1.*最终引用 1/)).toBeInTheDocument();
		expect(screen.getByText("同一来源片段数量限制")).toBeInTheDocument();
		expect(screen.getByText("已引用")).toBeInTheDocument();
		expect(screen.getByText("未引用")).toBeInTheDocument();
	});
	it("distinguishes a tool failure from a successful Qdrant HTTP response", () => {
		const diagnostics: CampusSearchDiagnostics = {
			diagnosticState: "COMPLETE",
			reason: null,
			calls: [
				{
					invocationId: "call",
					workflowStepId: "step",
					activityAttempt: 1,
					searchQuery: "夜宵",
					status: "failed",
					currentPhase: "failed",
					phaseTimes: {},
					queueMs: 0,
					toolTotalMs: 30,
					failureCode: "campus_search_retrieval_failed",
					httpStatus: 503,
					citedCount: 0,
					updatedAt: "2026-09-30T00:00:00Z",
					snapshot: {
						effectiveQuery: "夜宵",
						rerankQuery: "夜宵时间",
						citationStart: 1,
						resultLimit: 5,
						durations: {},
						retrievedCount: 1,
						deduplicatedCount: 0,
						rerankInputCount: 0,
						rerankKeptCount: 0,
						sourceGroupedCount: 0,
						sourceGroupedExcludedCount: 0,
						returnedCount: 0,
						excludedCount: 0,
						candidates: [],
						snapshotTruncated: false,
						failedStage: "retrieval",
						failureDetail:
							'campus notice Qdrant payload schema "campus_rag_point.v999" is unsupported',
						retrieval: {
							collection: "collection",
							httpStatus: 200,
							httpMs: 1,
							qdrantMs: 0,
							decodeMs: 0,
							postprocessMs: null,
						},
					},
				},
			],
		};
		render(<CampusSearchSection diagnostics={diagnostics} />);
		expect(screen.getByText(/工具 HTTP 503/)).toBeInTheDocument();
		expect(screen.getByText("Qdrant HTTP 状态：200")).toBeInTheDocument();
		expect(screen.getByText(/失败原因：.*campus_rag_point.v999.*unsupported/)).toBeInTheDocument();
		expect(screen.getByText("失败阶段：召回")).toBeInTheDocument();
	});
	it("shows absent diagnostics without implying retrieval failed", () => {
		render(<CampusSearchSection diagnostics={toCampusSearchDiagnostics([], true)} />);
		expect(screen.getByText(/诊断.*无数据/)).toBeInTheDocument();
		expect(screen.getByText(/旧请求不会回填/)).toBeInTheDocument();
	});
	it("polls only active requests", () => {
		expect(requestDetailPollInterval(undefined)).toBe(2000);
		expect(
			requestDetailPollInterval({
				request: { lifecyclePhase: "FINISHED" },
			} as OpsRequestDetailResponse),
		).toBe(false);
		expect(
			requestDetailPollInterval({
				request: { lifecyclePhase: "RUNNING" },
			} as OpsRequestDetailResponse),
		).toBe(2000);
	});
});

describe("post-answer memory polling", () => {
	const detail = (status: string, stages: Array<{ kind: string; status: string }>) =>
		({
			request: { lifecyclePhase: "FINISHED", status },
			execution: { stages },
		}) as OpsRequestDetailResponse;
	it.each(["pending", "running"])("continues for %s background work", (status) => {
		expect(requestDetailPollInterval(detail("COMPLETED", [{ kind: "memory", status }]))).toBe(2000);
		expect(requestDetailPollInterval(detail("COMPLETED", [{ kind: "finalization", status }]))).toBe(
			2000,
		);
	});
	it.each(["completed", "failed", "skipped"])("stops for %s memory", (status) => {
		expect(requestDetailPollInterval(detail("COMPLETED", [{ kind: "memory", status }]))).toBe(
			false,
		);
	});
	it.each(["FAILED", "CANCELED"])("does not wait after %s answer", (status) => {
		expect(requestDetailPollInterval(detail(status, [{ kind: "memory", status: "pending" }]))).toBe(
			false,
		);
	});
});
