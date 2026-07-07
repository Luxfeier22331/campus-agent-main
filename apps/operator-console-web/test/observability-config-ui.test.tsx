// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObservabilityConfigPage } from "../src/panel/operations/observability-config/page";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
}

function renderWithQueryClient(children: ReactNode) {
	return render(<QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>);
}

function mockConfig() {
	return new Response(
		JSON.stringify({
			config: {
				authHeaderConfigured: true,
				authHeaderFingerprint: "fingerprint",
				authHeaderLast4: "abcd",
				configId: "active",
				includeModelIo: false,
				mode: "langfuse_otlp",
				otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
				publicTraceBaseUrl: "https://cloud.langfuse.com/project/demo/traces",
				revision: 3,
				sampleRatio: 0.25,
				updatedAt: "2026-07-02T00:00:00.000Z",
				updatedBy: {
					displayName: "Ops Team",
					principalId: "operator-001",
				},
			},
		}),
		{ headers: { "content-type": "application/json" }, status: 200 },
	);
}

describe("observability config UI", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("presents LLM debug trace settings without exposing raw auth header", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockConfig());

		renderWithQueryClient(<ObservabilityConfigPage />);

		expect(await screen.findByText("LLM Debug Trace")).toBeInTheDocument();
		await waitFor(() => {
			expect(screen.getByLabelText("采样比例")).toHaveValue("0.25");
		});
		expect(screen.getByLabelText("OTLP Endpoint")).toHaveValue(
			"https://cloud.langfuse.com/api/public/otel",
		);
		expect(screen.getByLabelText("Trace 链接前缀")).toHaveValue(
			"https://cloud.langfuse.com/project/demo/traces",
		);
		expect(screen.getByText("已配置，尾号 abcd")).toBeInTheDocument();
		expect(screen.getByLabelText("Authorization Header")).toHaveValue("");
		expect(screen.queryByText("Basic langfuse-secret")).not.toBeInTheDocument();
	});

	it("saves enabled Langfuse OTLP config through the operator route", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockConfig())
			.mockResolvedValueOnce(mockConfig())
			.mockResolvedValueOnce(mockConfig());

		renderWithQueryClient(<ObservabilityConfigPage />);

		await screen.findByText("LLM Debug Trace");
		await waitFor(() => {
			expect(screen.getByLabelText("OTLP Endpoint")).toHaveValue(
				"https://cloud.langfuse.com/api/public/otel",
			);
		});
		fireEvent.change(screen.getByLabelText("采样比例"), { target: { value: "1" } });
		fireEvent.change(screen.getByLabelText("Authorization Header"), {
			target: { value: "Basic new-secret" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存观测配置" }));

		await waitFor(() => {
			expect(fetchSpy).toHaveBeenCalledWith(
				"/api/operator/observability-config/llm-debug-trace",
				expect.objectContaining({ method: "PATCH" }),
			);
		});
		const saveRequest = fetchSpy.mock.calls.find(
			(call) =>
				call[0] === "/api/operator/observability-config/llm-debug-trace" &&
				call[1]?.method === "PATCH",
		);
		const payload = JSON.parse(String(saveRequest?.[1]?.body));
		expect(payload).toMatchObject({
			authHeader: "Basic new-secret",
			includeModelIo: false,
			mode: "langfuse_otlp",
			otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
			publicTraceBaseUrl: "https://cloud.langfuse.com/project/demo/traces",
			sampleRatio: 1,
		});
	});
});
