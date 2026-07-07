import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getLlmDebugTraceConfig,
	updateLlmDebugTraceConfig,
} from "../src/panel/operations/observability-config/api";

describe("observability config panel client", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("loads LLM debug trace configuration without expecting raw auth header", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
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
			),
		);

		const result = await getLlmDebugTraceConfig();

		expect(result.config).not.toHaveProperty("authHeader");
		expect(result.config.authHeaderLast4).toBe("abcd");
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/observability-config/llm-debug-trace",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("sends raw auth header only in explicit update payloads", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ config: { configId: "active" } }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);

		await updateLlmDebugTraceConfig({
			authHeader: "Basic langfuse-secret",
			mode: "langfuse_otlp",
			otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
			publicTraceBaseUrl: "https://cloud.langfuse.com/project/demo/traces",
			sampleRatio: 1,
		});

		const [, init] = fetchSpy.mock.calls[0] ?? [];
		expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/operator/observability-config/llm-debug-trace");
		expect(init?.method).toBe("PATCH");
		expect(String(init?.body)).toContain("Basic langfuse-secret");
	});
});
