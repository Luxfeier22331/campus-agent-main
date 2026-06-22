// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	buildProviderConfigService,
	createInMemoryProviderConfigStore,
	type ProviderConfigService,
} from "../src/modules/provider-config";
import {
	env as baseEnv,
	createCampusPrincipal,
	createOperatorPrincipal,
} from "./operator-query.route.test-support";

const env = {
	...baseEnv,
	APP_API_INTERNAL_SHARED_SECRET: "provider-config-internal-secret",
};

describe("operator provider config routes", () => {
	it("creates provider connections and profiles without returning raw provider keys", async () => {
		const service = buildTestProviderConfigService();
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			providerConfigService: service,
		} as Parameters<typeof createApp>[1]);
		const promptConnectionResponse = await createConnection(
			app,
			connectionPayload({ apiKey: "sk-prompt-secret-1234", capabilities: ["prompt"] }),
		);
		const embeddingConnectionResponse = await createConnection(
			app,
			connectionPayload({
				apiKey: "emb-secret-5678",
				baseUrl: "https://embedding.example/v1",
				capabilities: ["embedding"],
			}),
		);

		const promptResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/provider-config/profiles", {
				body: JSON.stringify(
					promptProfilePayload({
						connectionId: connectionIdFromCreateResponse(
							await readConnectionJsonObject(promptConnectionResponse),
						),
					}),
				),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const embeddingResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/provider-config/profiles", {
				body: JSON.stringify(
					embeddingProfilePayload({
						connectionId: connectionIdFromCreateResponse(
							await readConnectionJsonObject(embeddingConnectionResponse),
						),
						role: "rag_query_embedding",
					}),
				),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(promptResponse.status).toBe(200);
		expect(embeddingResponse.status).toBe(200);
		const promptBodyText = await promptResponse.text();
		const embeddingBodyText = await embeddingResponse.text();
		expect(promptBodyText).not.toContain("sk-prompt-secret-1234");
		expect(embeddingBodyText).not.toContain("emb-secret-5678");
		expect(JSON.parse(promptBodyText)).toMatchObject({
			profile: {
				active: false,
				kind: "prompt",
				role: "primary_agent",
				status: "draft",
			},
		});
		expect(JSON.parse(embeddingBodyText)).toMatchObject({
			profile: {
				active: false,
				dimensions: 2560,
				kind: "embedding",
				role: "rag_query_embedding",
			},
		});
	});

	it("rejects non-operator access", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			providerConfigService: buildTestProviderConfigService(),
		} as Parameters<typeof createApp>[1]);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/provider-config/profiles"),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "forbidden",
			},
		});
	});

	it("validates provider profiles and records embedding dimension mismatches", async () => {
		const service = buildTestProviderConfigService({
			async validateEmbedding() {
				return {
					ok: false,
					status: "failed",
					errorCode: "embedding_dimensions_mismatch",
					message: "embedding dimensions mismatch: expected 1536, got 2560",
					observedDimensions: 2560,
				};
			},
		});
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			providerConfigService: service,
		} as Parameters<typeof createApp>[1]);
		const createResponse = await createEmbeddingProfile(app, { dimensions: 1536 });
		const profileId = profileIdFromCreateResponse(await readJsonObject(createResponse));

		const response = await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/provider-config/profiles/${profileId}/validate`,
				{
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			validation: {
				errorCode: "embedding_dimensions_mismatch",
				ok: false,
				observedDimensions: 2560,
				status: "failed",
			},
		});
	});

	it("blocks embedding model or dimension activation without index compatibility", async () => {
		const service = buildTestProviderConfigService({
			async checkEmbeddingCompatibility() {
				return {
					ok: false,
					reason: "rag release metadata vector size 1536 does not match 2560",
				};
			},
			async validateEmbedding() {
				return {
					ok: true,
					status: "passed",
					message: "embedding provider validated",
					observedDimensions: 2560,
				};
			},
		});
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			providerConfigService: service,
		} as Parameters<typeof createApp>[1]);
		const createResponse = await createEmbeddingProfile(app, { dimensions: 2560 });
		const profileId = profileIdFromCreateResponse(await readJsonObject(createResponse));
		await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/provider-config/profiles/${profileId}/validate`,
				{
					method: "POST",
				},
			),
		);

		const response = await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/provider-config/profiles/${profileId}/activate`,
				{
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "embedding_profile_incompatible",
			},
		});
	});

	it("exposes active provider snapshots for projection sync consumers", async () => {
		const service = buildTestProviderConfigService({
			async checkEmbeddingCompatibility() {
				return { ok: true };
			},
		});
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			providerConfigService: service,
		} as Parameters<typeof createApp>[1]);
		const promptCreateResponse = await createPromptProfile(app);
		const promptId = profileIdFromCreateResponse(await readJsonObject(promptCreateResponse));
		await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/provider-config/profiles/${promptId}/validate`,
				{
					method: "POST",
				},
			),
		);
		const activateResponse = await app.fetch(
			new Request(
				`https://app-api.internal/api/operator/provider-config/profiles/${promptId}/activate`,
				{
					method: "POST",
				},
			),
		);
		const activeResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/provider-config/active?role=primary_agent",
				{
					headers: { "x-app-internal-auth": "provider-config-internal-secret" },
				},
			),
		);

		expect(activateResponse.status).toBe(200);
		expect(activeResponse.status).toBe(200);
		await expect(activeResponse.json()).resolves.toMatchObject({
			profile: {
				api_key: "sk-test-provider-key",
				base_url: "https://provider.example/v1",
				model: "gpt-test",
				profile_id: promptId,
				provider: "openai",
				revision: 3,
				role: "primary_agent",
				transport: "responses",
			},
		});
	});

	it("rejects retired personal memory provider roles", async () => {
		const service = buildTestProviderConfigService();
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			providerConfigService: service,
		} as Parameters<typeof createApp>[1]);

		for (const role of ["personal_memory_extraction", "memory_graph_llm"]) {
			const connectionResponse = await createConnection(
				app,
				connectionPayload({ capabilities: ["prompt"] }),
			);
			const createResponse = await app.fetch(
				new Request("https://app-api.internal/api/operator/provider-config/profiles", {
					body: JSON.stringify({
						...promptProfilePayload({ role: "primary_agent" }),
						connectionId: connectionIdFromCreateResponse(
							await readConnectionJsonObject(connectionResponse),
						),
						role,
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				}),
			);
			const activeResponse = await app.fetch(
				new Request(`https://app-api.internal/api/internal/provider-config/active?role=${role}`, {
					headers: { "x-app-internal-auth": "provider-config-internal-secret" },
				}),
			);

			expect(createResponse.status).toBe(422);
			expect(activeResponse.status).toBe(422);
		}
	});

	it("exposes active Hindsight provider snapshots for projection sync", async () => {
		const service = buildTestProviderConfigService({
			async checkEmbeddingCompatibility() {
				throw new Error("Hindsight embedding must not call RAG compatibility check");
			},
		});
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
			providerConfigService: service,
		} as Parameters<typeof createApp>[1]);
		const llmCreateResponse = await createPromptProfile(app, {
			model: "gpt-memory",
			role: "hindsight_llm",
		});
		const embeddingCreateResponse = await createEmbeddingProfile(app, {
			model: "Qwen3-Embedding-4B",
			role: "hindsight_embedding",
		});
		const llmProfileId = profileIdFromCreateResponse(await readJsonObject(llmCreateResponse));
		const embeddingProfileId = profileIdFromCreateResponse(
			await readJsonObject(embeddingCreateResponse),
		);

		for (const profileId of [llmProfileId, embeddingProfileId]) {
			await app.fetch(
				new Request(
					`https://app-api.internal/api/operator/provider-config/profiles/${profileId}/validate`,
					{ method: "POST" },
				),
			);
			const activateResponse = await app.fetch(
				new Request(
					`https://app-api.internal/api/operator/provider-config/profiles/${profileId}/activate`,
					{ method: "POST" },
				),
			);
			expect(activateResponse.status).toBe(200);
		}

		const llmActiveResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/provider-config/active?role=hindsight_llm",
				{
					headers: { "x-app-internal-auth": "provider-config-internal-secret" },
				},
			),
		);
		const embeddingActiveResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/provider-config/active?role=hindsight_embedding",
				{
					headers: { "x-app-internal-auth": "provider-config-internal-secret" },
				},
			),
		);

		expect(llmActiveResponse.status).toBe(200);
		expect(embeddingActiveResponse.status).toBe(200);
		await expect(llmActiveResponse.json()).resolves.toMatchObject({
			profile: {
				api_key: "sk-test-provider-key",
				base_url: "https://provider.example/v1",
				kind: "prompt",
				model: "gpt-memory",
				role: "hindsight_llm",
				transport: "responses",
			},
		});
		await expect(embeddingActiveResponse.json()).resolves.toMatchObject({
			profile: {
				api_key: "sk-test-provider-key",
				base_url: "https://embedding.example/v1",
				dimensions: 2560,
				kind: "embedding",
				model: "Qwen3-Embedding-4B",
				role: "hindsight_embedding",
				transport: "embeddings",
			},
		});
	});
});

async function createPromptProfile(
	app: ReturnType<typeof createApp>,
	overrides: Partial<Record<string, unknown>> = {},
) {
	const connectionResponse = await createConnection(
		app,
		connectionPayload({ capabilities: ["prompt"] }),
	);
	return createProfile(
		app,
		promptProfilePayload({
			connectionId: connectionIdFromCreateResponse(
				await readConnectionJsonObject(connectionResponse),
			),
			...overrides,
		}),
	);
}

async function createEmbeddingProfile(
	app: ReturnType<typeof createApp>,
	overrides: Partial<Record<string, unknown>> = {},
) {
	const connectionResponse = await createConnection(
		app,
		connectionPayload({
			baseUrl: "https://embedding.example/v1",
			capabilities: ["embedding"],
		}),
	);
	return createProfile(
		app,
		embeddingProfilePayload({
			connectionId: connectionIdFromCreateResponse(
				await readConnectionJsonObject(connectionResponse),
			),
			...overrides,
		}),
	);
}

async function createConnection(
	app: ReturnType<typeof createApp>,
	payload: Record<string, unknown>,
) {
	const response = await app.fetch(
		new Request("https://app-api.internal/api/operator/provider-config/connections", {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	if (response.status !== 200) {
		throw new Error(`create provider connection returned HTTP ${response.status}`);
	}
	return response;
}

function buildTestProviderConfigService(
	overrides: Parameters<typeof buildProviderConfigService>[0]["validators"] = {},
): ProviderConfigService {
	return buildProviderConfigService({
		decryptSecret: (value) => value,
		encryptSecret: (value) => value,
		generateId: (prefix) => `${prefix}_test_${Math.random().toString(16).slice(2)}`,
		now: () => new Date("2026-06-16T00:00:00.000Z"),
		store: createInMemoryProviderConfigStore(),
		validators: {
			async checkEmbeddingCompatibility() {
				return { ok: true };
			},
			async validateEmbedding() {
				return {
					ok: true,
					status: "passed",
					message: "embedding provider validated",
					observedDimensions: 2560,
				};
			},
			async validatePrompt() {
				return { ok: true, status: "passed", message: "prompt provider validated" };
			},
			...overrides,
		},
	});
}

async function createProfile(app: ReturnType<typeof createApp>, payload: Record<string, unknown>) {
	const response = await app.fetch(
		new Request("https://app-api.internal/api/operator/provider-config/profiles", {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	if (response.status !== 200) {
		throw new Error(`create provider profile returned HTTP ${response.status}`);
	}
	return response;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
	const value = await response.json();
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("expected JSON object response");
	}
	return value as Record<string, unknown>;
}

function profileIdFromCreateResponse(value: Record<string, unknown>): string {
	const profile = value.profile;
	if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
		throw new Error("expected profile object response");
	}
	const profileId = (profile as Record<string, unknown>).profileId;
	if (typeof profileId !== "string" || !profileId.trim()) {
		throw new Error("expected profile.profileId response");
	}
	return profileId;
}

async function readConnectionJsonObject(response: Response): Promise<Record<string, unknown>> {
	return readJsonObject(response);
}

function connectionIdFromCreateResponse(value: Record<string, unknown>): string {
	const connection = value.connection;
	if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
		throw new Error("expected connection object response");
	}
	const connectionId = (connection as Record<string, unknown>).connectionId;
	if (typeof connectionId !== "string" || !connectionId.trim()) {
		throw new Error("expected connection.connectionId response");
	}
	return connectionId;
}

function connectionPayload(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		apiKey: "sk-test-provider-key",
		baseUrl: "https://provider.example/v1",
		capabilities: ["prompt"],
		capabilityConfig: {},
		provider: "openai",
		...overrides,
	};
}

function promptProfilePayload(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		connectionId: "provider_connection_test",
		kind: "prompt",
		role: "primary_agent",
		transport: "responses",
		model: "gpt-test",
		timeoutMs: 30000,
		...overrides,
	};
}

function embeddingProfilePayload(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		connectionId: "provider_connection_test",
		kind: "embedding",
		role: "rag_query_embedding",
		transport: "embeddings",
		model: "embedding-test",
		dimensions: 2560,
		timeoutMs: 30000,
		...overrides,
	};
}
