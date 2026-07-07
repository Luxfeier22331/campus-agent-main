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

	it("admits raw model IO only with an explicit raw capture policy", async () => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value.replace(/^encrypted:/u, ""),
			encryptSecret: (value) => `encrypted:${value}`,
			now: () => new Date("2026-06-20T00:00:00.000Z"),
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
			message: "includeModelIo=true requires an admitted raw_capture_policy.v1.",
		});

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

		await expect(service.getRuntimeSnapshot()).resolves.toMatchObject({
			config: {
				include_model_io: true,
				raw_capture_policy: rawCapturePolicy,
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

	it("rejects attempts to enable raw model IO with an incomplete policy", async () => {
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
					rawCapturePolicy: {
						schema_version: "raw_capture_policy.v1",
						mode: "manual_run_capture",
						capture_reason: "missing ttl",
						allowed_sinks: ["openai_agents_trace"],
						allowed_raw_fields: ["rendered_messages"],
						operator_principal: "operator:test",
						approval_ref: "approval:test:raw-capture",
						request_id: "req_rag_01",
						run_id: "run_rag_01",
						trace_id: "trace_rag_01",
						audit_required: true,
						dsar_delete_linkage_required: true,
					},
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			message: "rawCapturePolicy.ttl_days must be a positive integer when mode is not off.",
		});
	});

	it("allows an off raw capture policy without operator approval fields", async () => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			store: createInMemoryObservabilityConfigStore(),
		});

		await service.updateConfig({
			payload: {
				mode: "off",
				rawCapturePolicy: {
					schema_version: "raw_capture_policy.v1",
					mode: "off",
					capture_reason: "default disabled",
					ttl_days: 0,
					allowed_sinks: [],
					allowed_raw_fields: [],
					audit_required: false,
					dsar_delete_linkage_required: false,
				},
			},
			principal: createOperatorPrincipal(),
		});

		await expect(service.getRuntimeSnapshot()).resolves.toMatchObject({
			config: {
				raw_capture_policy: {
					approval_ref: null,
					mode: "off",
					operator_principal: null,
				},
			},
		});
	});

	it.each([
		["operator_principal", "approval_ref"],
		["approval_ref", "operator_principal"],
	])("rejects a non-off raw capture policy missing %s", async (_missingField, presentField) => {
		const service = buildObservabilityConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			store: createInMemoryObservabilityConfigStore(),
		});
		const rawCapturePolicy: Record<string, unknown> = {
			schema_version: "raw_capture_policy.v1",
			mode: "manual_run_capture",
			capture_reason: "diagnose badcase",
			ttl_days: 7,
			allowed_sinks: ["s3_replay_packet"],
			allowed_raw_fields: ["rendered_messages"],
			[presentField]: presentField === "operator_principal" ? "operator:test" : "approval:test",
			audit_required: true,
			dsar_delete_linkage_required: true,
		};

		await expect(
			service.updateConfig({
				payload: {
					mode: "off",
					rawCapturePolicy,
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			message:
				"rawCapturePolicy requires operator_principal and approval_ref when mode is not off.",
		});
	});
});
