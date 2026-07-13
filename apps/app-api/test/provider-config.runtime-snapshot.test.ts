// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildProviderConfigService,
	createInMemoryProviderConfigStore,
} from "../src/modules/provider-config";
import { createOperatorPrincipal } from "./operator-route.test-support";

describe("provider config runtime snapshots", () => {
	it("resolves eval LLM active projection snapshots", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_eval_llm`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt() {
					return { message: "prompt provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "eval-llm-key",
				baseUrl: "https://llm.example/v1",
				features: ["prompt"],
				provider: "openai",
			},
			principal: createOperatorPrincipal(),
		});
		for (const role of ["eval_ragas_llm", "eval_judge_llm"] as const) {
			const createdProfile = await service.createProfile({
				payload: {
					connectionId: createdConnection.connection.connectionId,
					kind: "prompt",
					model: "gpt-eval",
					role,
					timeoutMs: 30000,
					transport: "responses",
				},
				principal: createOperatorPrincipal(),
			});
			await service.validateProfile({
				principal: createOperatorPrincipal(),
				profileId: createdProfile.profile.profileId,
			});
			await service.activateProfile({
				principal: createOperatorPrincipal(),
				profileId: createdProfile.profile.profileId,
			});

			await expect(service.getActiveRuntimeSnapshot({ role })).resolves.toMatchObject({
				profile: {
					api_key: "eval-llm-key",
					base_url: "https://llm.example/v1",
					kind: "prompt",
					model: "gpt-eval",
					provider: "openai",
					role,
					transport: "responses",
				},
			});
		}
	});

	it("allows prompt provider profiles to use chat-completions transport", async () => {
		let validationInput: unknown = null;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_chat_completions`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt(input) {
					validationInput = input;
					return { message: "prompt provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "openai-compatible-key",
				baseUrl: "https://llm-compatible.example/v1",
				features: ["prompt"],
				provider: "openai-compatible",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "prompt",
				model: "gpt-compatible",
				role: "primary_agent",
				timeoutMs: 30000,
				transport: "chat_completions",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		expect(validationInput).toMatchObject({
			baseUrl: "https://llm-compatible.example/v1",
			model: "gpt-compatible",
			provider: "openai-compatible",
			role: "primary_agent",
			transport: "chat_completions",
		});
		await expect(
			service.getActiveRuntimeSnapshot({ role: "primary_agent" }),
		).resolves.toMatchObject({
			profile: {
				api_key: "openai-compatible-key",
				base_url: "https://llm-compatible.example/v1",
				kind: "prompt",
				model: "gpt-compatible",
				provider: "openai-compatible",
				role: "primary_agent",
				transport: "chat_completions",
			},
		});
	});

	it("removes active prompt profiles from runtime use when revalidation fails", async () => {
		let validationShouldPass = true;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_revalidation`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt() {
					return validationShouldPass
						? { message: "prompt provider validated", ok: true, status: "passed" }
						: {
								errorCode: "prompt_response_shape_invalid",
								message: "prompt provider responses response shape is not compatible.",
								ok: false,
								status: "failed",
							};
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "prompt-key",
				baseUrl: "https://llm.example/v1",
				features: ["prompt"],
				provider: "openai",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "prompt",
				model: "gpt-runtime",
				role: "primary_agent",
				timeoutMs: 30000,
				transport: "responses",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		validationShouldPass = false;
		const revalidated = await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		expect(revalidated.profile).toMatchObject({
			active: false,
			status: "validation_failed",
			validation: {
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			},
		});
		await expect(service.getActiveRuntimeSnapshot({ role: "primary_agent" })).rejects.toMatchObject(
			{
				code: "provider_profile_missing",
			},
		);
	});

	it("resolves Hindsight LLM active projection snapshots", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_hindsight_llm`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt() {
					return { message: "prompt provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "hindsight-llm-key",
				baseUrl: "https://llm.example/v1",
				features: ["prompt"],
				provider: "openai",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "prompt",
				model: "gpt-memory",
				role: "hindsight_llm",
				timeoutMs: 30000,
				transport: "responses",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		await expect(
			service.getActiveRuntimeSnapshot({ role: "hindsight_llm" }),
		).resolves.toMatchObject({
			profile: {
				api_key: "hindsight-llm-key",
				base_url: "https://llm.example/v1",
				kind: "prompt",
				model: "gpt-memory",
				provider: "openai",
				role: "hindsight_llm",
				transport: "responses",
			},
		});
	});
});
