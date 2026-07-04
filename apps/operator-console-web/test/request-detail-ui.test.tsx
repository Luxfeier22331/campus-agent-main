// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestDetailPage } from "../src/panel/app";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
}

function renderRequestDetail(children: ReactNode) {
	return render(
		<QueryClientProvider client={createQueryClient()}>
			<MemoryRouter initialEntries={["/requests/req_01HQ"]}>
				<Routes>
					<Route element={children} path="/requests/:requestId" />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("request detail UI", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders safe timing, model, tool, retrieval, and external trace references", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					opsIndex: {
						debugTraceRefs: [
							{
								sink: "langfuse",
								traceId: "trace_01HQ",
								traceRef: "lf_trace_01HQ",
								url: "https://langfuse.example/project/traces/lf_trace_01HQ",
							},
						],
						model: {
							billableStepCount: 2,
							cachedInputTokens: 12,
							estimatedCostMicrousd: 120,
							executionDetail: "completed",
							executionState: "completed",
							inputTokens: 300,
							modelName: "gpt-test",
							modelProvider: "openai",
							outputTokens: 80,
							promptId: "campus-primary-agent",
							promptVersion: "current",
							templateSha256: "sha256-template",
							usageSummary: [],
						},
						retrieval: {
							adequacyReason: "enough_evidence",
							adequacyVerdict: "adequate",
							candidateCount: 8,
							collection: "student_rules",
							retrievalAttempted: true,
							retrievedSourceCount: 3,
						},
						sinkLinks: {
							projectionLagMs: 250,
							traceAvailable: true,
						},
						stageTiming: {
							"request.total_ms": 812,
							"stream.browser_ttft_ms": 2700,
							"agent.primary_ms": 15_200,
							"memory.recall_ms": 34,
							"tool.knowledge_query_ms": 760,
							"rag.lookup_ms": 180,
							"finalization.write_ms": 9,
							"projection.closeout_ms": 14,
						},
						stageTimingBudget: {
							"request.total_ms": {
								budgetState: "within_budget",
								budgetVersion: "latency-budget-v1",
								criticalMs: 15000,
								durationMs: 812,
								warnMs: 8000,
							},
							"stream.browser_ttft_ms": {
								budgetState: "warn",
								budgetVersion: "latency-budget-v1",
								criticalMs: 5000,
								durationMs: 2700,
								warnMs: 2500,
							},
							"agent.primary_ms": {
								budgetState: "critical",
								budgetVersion: "latency-budget-v1",
								criticalMs: 14000,
								durationMs: 15200,
								warnMs: 7000,
							},
						},
						tool: {
							failClosed: false,
							failCloseReason: null,
							historicalDowngradeReason: null,
							requestedTool: "knowledge_query",
							selectedTool: "knowledge_query",
							toolBusinessOutcome: "answered",
						},
					},
					request: {
						answerPreview: "图书馆开放到 22:00。",
						applicabilityScope: null,
						completedAt: "2026-03-28T08:00:01.000Z",
						conversationId: "conv_01HQ",
						durationMs: 812,
						errorCode: null,
						entitlementGroups: [],
						entitlementSnapshotId: null,
						principalId: "user_01HQ",
						principalLabel: "Jane Doe",
						principalType: "campus_member",
						projectedAt: "2026-03-28T08:00:02.000Z",
						questionPreview: "图书馆开放到几点？",
						requestId: "req_01HQ",
						requestedTool: "knowledge_query",
						requestedScope: null,
						resolvedScope: null,
						runId: "run_01HQ",
						selectedTool: "knowledge_query",
						sourceDocIds: [],
						startedAt: "2026-03-28T08:00:00.000Z",
						status: "completed",
						surface: "campus_web",
						traceId: "trace_01HQ",
						visibilityScope: null,
					},
				}),
				{ headers: { "content-type": "application/json" } },
			),
		);

		renderRequestDetail(<RequestDetailPage />);

		expect(await screen.findByText("请求详情")).toBeInTheDocument();
		expect(await screen.findByText("运行耗时")).toBeInTheDocument();
		expect(screen.getByText("请求总耗时")).toBeInTheDocument();
		expect(screen.getByText("首字输出")).toBeInTheDocument();
		expect(screen.getByText("记忆召回")).toBeInTheDocument();
		expect(screen.getByText("主智能体")).toBeInTheDocument();
		expect(screen.getByText("知识工具")).toBeInTheDocument();
		expect(screen.getByText("检索查询")).toBeInTheDocument();
		expect(screen.getByText("最终投影")).toBeInTheDocument();
		expect(screen.getByText("投影收口")).toBeInTheDocument();
		expect(screen.getByText("15.2 s")).toBeInTheDocument();
		expect(screen.getByText("接近预算")).toBeInTheDocument();
		expect(screen.getByText("超出预算")).toBeInTheDocument();
		expect(document.body.textContent).toContain("latency-budget-v1");
		expect(document.body.textContent).not.toContain("agent.primary_ms");
		expect(screen.getByText("模型与工具")).toBeInTheDocument();
		expect(screen.getByText("openai / gpt-test")).toBeInTheDocument();
		expect(screen.getAllByText("knowledge_query").length).toBeGreaterThan(0);
		expect(screen.getByText("检索")).toBeInTheDocument();
		expect(screen.getByText("student_rules")).toBeInTheDocument();
		expect(screen.getByText("3 个来源")).toBeInTheDocument();
		expect(screen.getByText("外部追踪")).toBeInTheDocument();
		const traceLink = screen.getByRole("link", { name: /langfuse/ });
		expect(traceLink).toHaveAttribute(
			"href",
			"https://langfuse.example/project/traces/lf_trace_01HQ",
		);
		expect(document.body.textContent).not.toMatch(/rawPrompt|rawAnswer|providerPayload|traceBody/i);
	});

	it("renders a neutral state when ops index is not available", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					opsIndex: null,
					request: {
						answerPreview: null,
						applicabilityScope: null,
						completedAt: null,
						conversationId: "conv_01HQ",
						durationMs: null,
						errorCode: null,
						entitlementGroups: [],
						entitlementSnapshotId: null,
						principalId: "user_01HQ",
						principalLabel: null,
						principalType: "campus_member",
						projectedAt: "2026-03-28T08:00:02.000Z",
						questionPreview: "图书馆开放到几点？",
						requestId: "req_01HQ",
						requestedTool: null,
						requestedScope: null,
						resolvedScope: null,
						runId: null,
						selectedTool: null,
						sourceDocIds: [],
						startedAt: "2026-03-28T08:00:00.000Z",
						status: "accepted",
						surface: "campus_web",
						traceId: "trace_01HQ",
						visibilityScope: null,
					},
				}),
				{ headers: { "content-type": "application/json" } },
			),
		);

		renderRequestDetail(<RequestDetailPage />);

		const detail = await screen.findByText("请求详情");
		expect(detail).toBeInTheDocument();
		expect(await screen.findByText("运行观测暂未上报")).toBeInTheDocument();
		expect(within(document.body).queryByText("外部追踪")).not.toBeInTheDocument();
	});
});
