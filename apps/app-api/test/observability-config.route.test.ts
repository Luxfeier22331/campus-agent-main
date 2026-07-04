// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	buildObservabilityConfigService,
	createInMemoryObservabilityConfigStore,
} from "../src/modules/observability-config";
import {
	env as baseEnv,
	createCampusPrincipal,
	createOperatorPrincipal,
} from "./operator-query.route.test-support";

const env = {
	...baseEnv,
	APP_API_INTERNAL_SHARED_SECRET: "observability-config-internal-secret",
};

describe("observability config routes", () => {
	it("lets operators manage LLM debug trace config without returning raw auth header", async () => {
		const service = buildTestObservabilityConfigService();
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			observabilityConfigService: service,
		} as Parameters<typeof createApp>[1]);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/observability-config/llm-debug-trace", {
				body: JSON.stringify({
					authHeader: "Basic langfuse-secret",
					mode: "langfuse_otlp",
					otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
					publicTraceBaseUrl: "https://cloud.langfuse.com/project/demo/traces",
				}),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);

		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toContain("Basic langfuse-secret");
		expect(JSON.parse(text)).toMatchObject({
			config: {
				authHeaderConfigured: true,
				authHeaderLast4: "cret",
				mode: "langfuse_otlp",
				otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
			},
		});
	});

	it("exposes decrypted runtime snapshot only to internal callers", async () => {
		const service = buildTestObservabilityConfigService();
		await service.updateConfig({
			payload: {
				authHeader: "Basic langfuse-secret",
				mode: "langfuse_otlp",
				otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
			},
			principal: createOperatorPrincipal(),
		});
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			observabilityConfigService: service,
		} as Parameters<typeof createApp>[1]);

		const unauthorized = await app.fetch(
			new Request("https://app-api.internal/api/internal/observability-config/llm-debug-trace"),
		);
		const authorized = await app.fetch(
			new Request("https://app-api.internal/api/internal/observability-config/llm-debug-trace", {
				headers: { "x-app-internal-auth": "observability-config-internal-secret" },
			}),
		);

		expect(unauthorized.status).toBe(401);
		expect(authorized.status).toBe(200);
		await expect(authorized.json()).resolves.toMatchObject({
			config: {
				langfuse_otlp: {
					auth_header: "Basic langfuse-secret",
					endpoint: "https://cloud.langfuse.com/api/public/otel",
				},
				mode: "langfuse_otlp",
				schema_version: "llm_debug_trace_config.v1",
			},
		});
	});

	it("rejects non-operator browser access", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			observabilityConfigService: buildTestObservabilityConfigService(),
		} as Parameters<typeof createApp>[1]);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/observability-config/llm-debug-trace"),
		);

		expect(response.status).toBe(403);
	});
});

function buildTestObservabilityConfigService() {
	return buildObservabilityConfigService({
		decryptSecret: (value) => value.replace(/^encrypted:/u, ""),
		encryptSecret: (value) => `encrypted:${value}`,
		now: () => new Date("2026-06-20T00:00:00.000Z"),
		store: createInMemoryObservabilityConfigStore(),
	});
}
