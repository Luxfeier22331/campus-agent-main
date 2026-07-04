// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildObservabilityConfigService,
	createInMemoryObservabilityConfigStore,
} from "../src/modules/observability-config";
import {
	createCampusPrincipal,
	createOperatorPrincipal,
} from "./operator-query.route.test-support";

describe("observability config service", () => {
	it("stores operator-managed LLM debug trace config without exposing raw auth header", async () => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => `encrypted:${value}`,
			now: () => new Date("2026-06-20T00:00:00.000Z"),
			store: createInMemoryObservabilityConfigStore(),
		});

		const updated = await service.updateConfig({
			payload: {
				authHeader: "Basic langfuse-secret",
				mode: "langfuse_otlp",
				otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
				publicTraceBaseUrl: "https://cloud.langfuse.com/project/demo/traces",
				sampleRatio: 0.25,
			},
			principal: createOperatorPrincipal(),
		});
		const rendered = JSON.stringify(updated);

		expect(rendered).not.toContain("Basic langfuse-secret");
		expect(updated.config).toMatchObject({
			authHeaderConfigured: true,
			authHeaderLast4: "cret",
			includeModelIo: false,
			mode: "langfuse_otlp",
			otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
			publicTraceBaseUrl: "https://cloud.langfuse.com/project/demo/traces",
			revision: 1,
			sampleRatio: 0.25,
		});
	});

	it("returns decrypted runtime snapshot only through the runtime snapshot method", async () => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value.replace(/^encrypted:/u, ""),
			encryptSecret: (value) => `encrypted:${value}`,
			now: () => new Date("2026-06-20T00:00:00.000Z"),
			store: createInMemoryObservabilityConfigStore(),
		});

		await service.updateConfig({
			payload: {
				authHeader: "Basic langfuse-secret",
				mode: "langfuse_otlp",
				otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
			},
			principal: createOperatorPrincipal(),
		});

		await expect(service.getRuntimeSnapshot()).resolves.toEqual({
			config: {
				include_model_io: false,
				langfuse_otlp: {
					auth_header: "Basic langfuse-secret",
					endpoint: "https://cloud.langfuse.com/api/public/otel",
				},
				mode: "langfuse_otlp",
				sample_ratio: 1,
				schema_version: "llm_debug_trace_config.v1",
			},
		});
	});

	it("rejects non-operator config access and incomplete langfuse OTLP config", async () => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			store: createInMemoryObservabilityConfigStore(),
		});

		await expect(service.getConfig({ principal: createCampusPrincipal() })).rejects.toMatchObject({
			code: "forbidden",
		});
		await expect(
			service.updateConfig({
				payload: {
					mode: "langfuse_otlp",
					otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("rejects invalid Langfuse OTLP endpoint and auth header shape", async () => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			store: createInMemoryObservabilityConfigStore(),
		});

		await expect(
			service.updateConfig({
				payload: {
					authHeader: "Bearer token",
					mode: "langfuse_otlp",
					otlpEndpoint: "https://cloud.langfuse.com/api/public/otel",
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({ code: "validation_failed" });
		await expect(
			service.updateConfig({
				payload: {
					authHeader: "Basic langfuse-secret",
					mode: "langfuse_otlp",
					otlpEndpoint: "https://otel.example/v1/traces",
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("rejects attempts to enable raw model IO from operator config", async () => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			store: createInMemoryObservabilityConfigStore(),
		});

		await expect(
			service.updateConfig({
				payload: {
					includeModelIo: true,
					mode: "off",
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			message: "includeModelIo is currently fixed to false.",
		});
	});
});
