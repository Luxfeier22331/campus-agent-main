// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildProviderConfigService,
	createInMemoryProviderConfigStore,
} from "../src/modules/provider-config";
import { createOperatorPrincipal } from "./operator-query.route.test-support";

describe("provider config public web search service", () => {
	it("accepts public web search profiles with admitted compatible provider identity", async () => {
		let validationInput: unknown = null;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_public_web_search`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validateSearch(input) {
					validationInput = input;
					return { message: "search provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "search-key",
				baseUrl: "https://compatible-search.example",
				features: ["search"],
				provider: "perplexity_compatible",
			},
			principal: createOperatorPrincipal(),
		});

		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "search",
				model: "sonar-compatible",
				role: "public_web_search",
				timeoutMs: 30000,
				transport: "perplexity_search",
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
			baseUrl: "https://compatible-search.example",
			model: "sonar-compatible",
			provider: "perplexity_compatible",
			role: "public_web_search",
			transport: "perplexity_search",
		});
		await expect(
			service.getActiveRuntimeSnapshot({ role: "public_web_search" }),
		).resolves.toMatchObject({
			profile: {
				base_url: "https://compatible-search.example",
				kind: "search",
				model: "sonar-compatible",
				provider: "perplexity_compatible",
				role: "public_web_search",
				transport: "perplexity_search",
			},
		});
	});

	it("accepts OpenAI and Gemini public web search candidates as explicit transports", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_public_web_search`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validateSearch() {
					return { message: "search provider validated", ok: true, status: "passed" };
				},
			},
		});

		for (const candidate of [
			{
				baseUrl: "https://api.openai.com/v1",
				model: "gpt-5-search-api",
				provider: "openai",
				transport: "openai_responses_web_search",
			},
			{
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				model: "gemini-2.5-flash",
				provider: "gemini",
				transport: "gemini_google_search",
			},
		]) {
			const createdConnection = await service.createConnection({
				payload: {
					apiKey: `${candidate.provider}-key`,
					baseUrl: candidate.baseUrl,
					features: ["search"],
					provider: candidate.provider,
				},
				principal: createOperatorPrincipal(),
			});
			const createdProfile = await service.createProfile({
				payload: {
					connectionId: createdConnection.connection.connectionId,
					kind: "search",
					model: candidate.model,
					role: "public_web_search",
					timeoutMs: 30000,
					transport: candidate.transport,
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
				service.getActiveRuntimeSnapshot({ role: "public_web_search" }),
			).resolves.toMatchObject({
				profile: {
					base_url: candidate.baseUrl,
					kind: "search",
					model: candidate.model,
					provider: candidate.provider,
					role: "public_web_search",
					transport: candidate.transport,
				},
			});
		}
	});

	it("accepts Linux.do public web search as a dedicated search profile", async () => {
		let validationInput: unknown = null;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_public_web_search`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validateSearch(input) {
					validationInput = input;
					return { message: "search provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "linux-do-key",
				baseUrl: "https://hub.linux.do/v1",
				features: ["search"],
				provider: "linux_do",
			},
			principal: createOperatorPrincipal(),
		});

		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "search",
				model: "gpt-5-search-api-2025-10-14",
				role: "public_web_search",
				timeoutMs: 30000,
				transport: "openai_chat_completions_web_search",
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
			baseUrl: "https://hub.linux.do/v1",
			model: "gpt-5-search-api-2025-10-14",
			provider: "linux_do",
			role: "public_web_search",
			transport: "openai_chat_completions_web_search",
		});
		await expect(
			service.getActiveRuntimeSnapshot({ role: "public_web_search" }),
		).resolves.toMatchObject({
			profile: {
				base_url: "https://hub.linux.do/v1",
				kind: "search",
				model: "gpt-5-search-api-2025-10-14",
				provider: "linux_do",
				role: "public_web_search",
				transport: "openai_chat_completions_web_search",
			},
		});
	});
});
