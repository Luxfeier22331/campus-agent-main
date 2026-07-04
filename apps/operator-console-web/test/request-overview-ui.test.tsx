// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestsPage } from "../src/panel/app";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
}

function renderRequestsPage() {
	return render(
		<QueryClientProvider client={createQueryClient()}>
			<MemoryRouter initialEntries={["/requests"]}>
				<Routes>
					<Route element={<RequestsPage />} path="/requests" />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("request overview UI", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders minimal stage latency trends from the operator overview", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("/api/operator/overview")) {
				return new Response(
					JSON.stringify({
						asOf: "2026-03-28T09:00:00.000Z",
						overview: {
							failureRate: { count: 0, eligibleCount: 2, value: 0 },
							latency: { p50Ms: 800, p95Ms: 1200, p99Ms: 1200 },
							latencyBudget: {
								criticalFieldCount: 1,
								version: "latency-budget-v1",
								warnFieldCount: 2,
								worstField: "stream.browser_ttft_ms",
							},
							requestVolume: { accepted: 2, completed: 2, errored: 0 },
							sinkHealth: {
								missingTraceRate: { count: 0, eligibleCount: 2, value: 0 },
								outboxPendingCount: 0,
								outboxRetryCount: 0,
								outboxStaleCount: 0,
								projectionFailureCount: 0,
							},
							stageLatency: {
								"agent.runtime_ms": {
									criticalCount: 0,
									p50Ms: 900,
									p95Ms: 1500,
									p99Ms: 1500,
									sampleCount: 2,
									warnCount: 0,
								},
								"rag.lookup_ms": {
									criticalCount: 0,
									p50Ms: 400,
									p95Ms: 1800,
									p99Ms: 1800,
									sampleCount: 2,
									warnCount: 1,
								},
								"stream.browser_ttft_ms": {
									criticalCount: 1,
									p50Ms: 900,
									p95Ms: 5500,
									p99Ms: 5500,
									sampleCount: 2,
									warnCount: 1,
								},
							},
						},
						window: {
							from: "2026-03-27T09:00:00.000Z",
							granularity: "1h",
							to: "2026-03-28T09:00:00.000Z",
						},
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			if (url === "/api/operator/runtime/health") {
				return new Response(
					JSON.stringify({
						asOf: "2026-03-28T09:00:00.000Z",
						executionRuntime: {
							blockers: {},
							checks: { runProjectionStore: "ready", temporalRuntime: "ready" },
							status: "ready",
						},
						runProjectionStore: null,
						status: "ready",
						temporalRuntime: null,
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			if (url === "/api/overview") {
				return new Response(
					JSON.stringify({
						operatorContext: { displayName: "Ops", email: "ops@example.edu.cn" },
						protectionEnvelope: "受保护访问",
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			if (url.startsWith("/api/requests")) {
				return new Response(JSON.stringify({ data: [], total: 0 }), {
					headers: { "content-type": "application/json" },
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		});

		renderRequestsPage();

		expect(await screen.findByText("运行趋势")).toBeInTheDocument();
		expect(screen.getByText("首字 P95")).toBeInTheDocument();
		expect(await screen.findByText("5.5 s")).toBeInTheDocument();
		expect(screen.getByText("模型运行 P95")).toBeInTheDocument();
		expect(screen.getByText("RAG 查询 P95")).toBeInTheDocument();
		expect(screen.getByText("超预算字段")).toBeInTheDocument();
		expect(screen.getByText("1 / 2")).toBeInTheDocument();
		expect(document.body.textContent).not.toContain("stream.browser_ttft_ms");
	});
});
