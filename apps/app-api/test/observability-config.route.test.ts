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
		const rawCapturePolicy = {
			schema_version: "raw_capture_policy.v1",
			mode: "manual_run_capture",
			capture_reason: "diagnose badcase req_debug_001",
			ttl_days: 7,
			allowed_sinks: ["openai_agents_trace", "langfuse_otlp"],
			allowed_raw_fields: ["rendered_messages", "provider_request_body"],
			operator_principal: "operator:test",
			approval_ref: "approval:test:raw-capture",
			request_id: "req_rag_01",
			run_id: "run_rag_01",
			trace_id: "trace_rag_01",
			audit_required: true,
			dsar_delete_linkage_required: true,
		};
		await service.updateConfig({
			payload: {
				authHeader: "Basic langfuse-secret",
				includeModelIo: true,
				mode: "langfuse_otlp",
				otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
				rawCapturePolicy,
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
				include_model_io: true,
				langfuse_otlp: {
					auth_header: "Basic langfuse-secret",
					endpoint: "https://cloud.langfuse.com/api/public/otel",
				},
				mode: "langfuse_otlp",
				raw_capture_policy: rawCapturePolicy,
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
