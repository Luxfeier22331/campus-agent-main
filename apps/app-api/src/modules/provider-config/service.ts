import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ProviderConfigStore } from "./store";
import type {
	EmbeddingProviderRole,
	PromptProviderRole,
	ProviderConfigActor,
	ProviderConfigConnection,
	ProviderConfigConnectionCreatePayload,
	ProviderConfigConnectionSummary,
	ProviderConfigConnectionUpdatePayload,
	ProviderConfigCreatePayload,
	ProviderConfigFeature,
	ProviderConfigFeatureConfig,
	ProviderConfigKind,
	ProviderConfigProfile,
	ProviderConfigProfileSummary,
	ProviderConfigRole,
	ProviderConfigRuntimeSnapshot,
	ProviderConfigSecretRef,
	ProviderConfigService,
	ProviderConfigUpdatePayload,
	ProviderConfigValidationResult,
	ProviderConfigValidators,
	RerankProviderRole,
} from "./types";
import {
	defaultEmbeddingCompatibilityCheck,
	defaultValidateEmbeddingProvider,
	defaultValidatePromptProvider,
	defaultValidateRerankProvider,
	validateByKind,
} from "./validators";

export interface ProviderConfigServiceDependencies {
	decryptSecret?: (ciphertext: string) => Promise<string> | string;
	encryptionKey?: string;
	encryptSecret?: (plaintext: string) => Promise<string> | string;
	generateId?: (prefix: string) => string;
	now?: () => Date;
	store: ProviderConfigStore;
	validators?: Partial<ProviderConfigValidators>;
}

const PROMPT_ROLES = new Set<PromptProviderRole>([
	"eval_judge_llm",
	"eval_ragas_llm",
	"hindsight_llm",
	"primary_agent",
	"rag_synthesis",
]);
const EMBEDDING_ROLES = new Set<EmbeddingProviderRole>([
	"eval_ragas_embedding",
	"hindsight_embedding",
	"index_embedding",
	"rag_query_embedding",
]);
const RERANK_ROLES = new Set<RerankProviderRole>(["rag_reranker"]);
const FEATURES = new Set<ProviderConfigFeature>(["embedding", "prompt", "rerank"]);
const DEFAULT_TIMEOUT_MS = 30_000;

export function buildProviderConfigService(
	dependencies: ProviderConfigServiceDependencies,
): ProviderConfigService {
	const generateId =
		dependencies.generateId ?? ((prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`);
	const now = dependencies.now ?? (() => new Date());
	const encryptSecret =
		dependencies.encryptSecret ??
		((value: string) => encryptProviderConfigSecret(value, dependencies.encryptionKey));
	const decryptSecret =
		dependencies.decryptSecret ??
		((value: string) => decryptProviderConfigSecret(value, dependencies.encryptionKey));
	const validators = {
		checkEmbeddingCompatibility:
			dependencies.validators?.checkEmbeddingCompatibility ?? defaultEmbeddingCompatibilityCheck,
		validateEmbedding:
			dependencies.validators?.validateEmbedding ?? defaultValidateEmbeddingProvider,
		validatePrompt: dependencies.validators?.validatePrompt ?? defaultValidatePromptProvider,
		validateRerank: dependencies.validators?.validateRerank ?? defaultValidateRerankProvider,
	};

	return {
		async createConnection(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const normalized = normalizeConnectionCreatePayload(input.payload);
			const createdAt = now().toISOString();
			const connection: ProviderConfigConnection = {
				apiKeySecret: await secretRefFromPlaintext(normalized.apiKey, encryptSecret),
				baseUrl: normalized.baseUrl,
				features: normalized.features,
				featureConfig: normalized.featureConfig,
				connectionId: generateId("provider_connection"),
				createdAt,
				createdBy: actor,
				provider: normalized.provider,
				revision: 1,
				updatedAt: createdAt,
				updatedBy: actor,
			};
			await dependencies.store.saveConnection(connection);
			return { connection: summarizeConnection(connection) };
		},
		async activateProfile(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const profile = await requireProfile(dependencies.store, input.profileId);
			const connection = await requireConnection(dependencies.store, profile.connectionId);
			if (!profile.validation?.ok) {
				throw routeError({
					code: "provider_profile_not_validated",
					message: "Provider profile must pass validation before activation.",
					status: 409,
				});
			}
			if (profile.kind === "embedding" && profile.role === "rag_query_embedding") {
				const rawApiKey = await decryptSecret(connection.apiKeySecret.ciphertext);
				const compatibility = await validators.checkEmbeddingCompatibility({
					apiKey: rawApiKey,
					baseUrl: connection.baseUrl,
					featureConfig: connection.featureConfig,
					dimensions: profile.dimensions,
					model: profile.model,
					provider: connection.provider,
					role: profile.role,
					timeoutMs: profile.timeoutMs,
					transport: profile.transport,
				});
				if (!compatibility.ok) {
					throw routeError({
						code: "embedding_profile_incompatible",
						details: { reason: compatibility.reason ?? null },
						message:
							compatibility.reason ?? "Embedding profile is not compatible with active indexes.",
						status: 409,
					});
				}
			}
			const activated: ProviderConfigProfile = {
				...profile,
				active: true,
				revision: profile.revision + 1,
				status: "active",
				updatedAt: now().toISOString(),
				updatedBy: actor,
			};
			await dependencies.store.setActive(activated);
			return { profile: summarizeProfile(activated, connection) };
		},
		async createProfile(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const normalized = normalizeCreatePayload(input.payload);
			const connection = await requireConnection(dependencies.store, normalized.connectionId);
			requireConnectionTool(connection, normalized.kind);
			const createdAt = now().toISOString();
			const profile: ProviderConfigProfile = {
				active: false,
				connectionId: connection.connectionId,
				createdAt,
				createdBy: actor,
				dimensions: normalized.dimensions,
				kind: normalized.kind,
				model: normalized.model,
				profileId: generateId("provider_profile"),
				revision: 1,
				role: normalized.role,
				status: "draft",
				timeoutMs: normalized.timeoutMs,
				transport: normalized.transport,
				updatedAt: createdAt,
				updatedBy: actor,
				validation: null,
			};
			await dependencies.store.save(profile);
			return { profile: summarizeProfile(profile, connection) };
		},
		async getActiveRuntimeSnapshot(input) {
			const role = normalizeRuntimeRole(input.role);
			const profile = await dependencies.store.getActiveByRole(role);
			if (profile === null) {
				throw routeError({
					code: "provider_profile_missing",
					message: `No active provider profile for role ${role}.`,
					status: 404,
				});
			}
			if (profile.status !== "active" || !profile.validation?.ok) {
				throw routeError({
					code: "provider_profile_not_validated",
					details: {
						profileId: profile.profileId,
						role,
						status: profile.status,
						validationStatus: profile.validation?.status ?? null,
					},
					message: `Active provider profile for role ${role} is not validated for runtime use.`,
					status: 409,
				});
			}
			const connection = await requireConnection(dependencies.store, profile.connectionId);
			return {
				profile: runtimeSnapshotFromProfile(
					profile,
					connection,
					await decryptSecret(connection.apiKeySecret.ciphertext),
				),
			};
		},
		async listConnections(input) {
			ensureOperatorPrincipal(input.principal);
			return {
				connections: (await dependencies.store.listConnections()).map(summarizeConnection),
			};
		},
		async listProfiles(input) {
			ensureOperatorPrincipal(input.principal);
			return {
				profiles: await summarizeProfiles(dependencies.store, await dependencies.store.list()),
			};
		},
		async updateProfile(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const current = await requireProfile(dependencies.store, input.profileId);
			if (current.active) {
				throw routeError({
					code: "active_provider_profile_immutable",
					message: "Active provider profiles must be replaced by creating a new profile revision.",
					status: 409,
				});
			}
			const normalized = await normalizeUpdatePayload(current, input.payload);
			let connection = await requireConnection(dependencies.store, current.connectionId);
			if (normalized.connectionId) {
				connection = await requireConnection(dependencies.store, normalized.connectionId);
				requireConnectionTool(connection, current.kind);
			}
			const updated: ProviderConfigProfile = {
				...current,
				...normalized,
				revision: current.revision + 1,
				status: "draft",
				updatedAt: now().toISOString(),
				updatedBy: actor,
				validation: null,
			};
			await dependencies.store.save(updated);
			return { profile: summarizeProfile(updated, connection) };
		},
		async updateConnection(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const current = await requireConnection(dependencies.store, input.connectionId);
			const normalized = await normalizeConnectionUpdatePayload(
				current,
				input.payload,
				encryptSecret,
			);
			const updated: ProviderConfigConnection = {
				...current,
				...normalized,
				revision: current.revision + 1,
				updatedAt: now().toISOString(),
				updatedBy: actor,
			};
			await dependencies.store.saveConnection(updated);
			return { connection: summarizeConnection(updated) };
		},
		async validateProfile(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const current = await requireProfile(dependencies.store, input.profileId);
			const connection = await requireConnection(dependencies.store, current.connectionId);
			requireConnectionTool(connection, current.kind);
			const apiKey = await decryptSecret(connection.apiKeySecret.ciphertext);
			const validatorInput = {
				apiKey,
				baseUrl: connection.baseUrl,
				featureConfig: connection.featureConfig,
				dimensions: current.dimensions,
				model: current.model,
				provider: connection.provider,
				role: current.role,
				timeoutMs: current.timeoutMs,
				transport: current.transport,
			};
			const validation = await validateByKind(current.kind, validatorInput, validators);
			const withTimestamp: ProviderConfigValidationResult = {
				...validation,
				validatedAt: validation.validatedAt ?? now().toISOString(),
			};
			const activeAfterValidation = current.active && withTimestamp.ok;
			const next: ProviderConfigProfile = {
				...current,
				active: activeAfterValidation,
				revision: current.revision + 1,
				status: activeAfterValidation
					? "active"
					: withTimestamp.ok
						? "validated"
						: "validation_failed",
				updatedAt: now().toISOString(),
				updatedBy: actor,
				validation: withTimestamp,
			};
			await dependencies.store.save(next);
			return { profile: summarizeProfile(next, connection), validation: withTimestamp };
		},
	};
}

function routeError(input: {
	code: string;
	details?: unknown;
	message: string;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		details: input.details,
		message: input.message,
		retryable: false,
		status: input.status,
	});
}

function validationError(message: string, details?: unknown): AppApiRouteError {
	return routeError({
		code: "validation_failed",
		details,
		message,
		status: 422,
	});
}

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): ProviderConfigActor {
	if (!principal.permissions.operator) {
		throw routeError({
			code: "forbidden",
			message: "Operator access is not available for this principal.",
			status: 403,
		});
	}
	const principalId = principal.principal.principalId.trim();
	if (!principalId) {
		throw routeError({
			code: "invalid_principal",
			message: "Provider config requires a stable operator principal id.",
			status: 403,
		});
	}
	return {
		displayName: principal.principal.displayName.trim() || principalId,
		principalId,
	};
}

async function requireProfile(
	store: ProviderConfigStore,
	profileId: string,
): Promise<ProviderConfigProfile> {
	const profile = await store.getById(profileId);
	if (profile === null) {
		throw routeError({
			code: "provider_profile_not_found",
			message: "Provider profile was not found.",
			status: 404,
		});
	}
	return profile;
}

async function requireConnection(
	store: ProviderConfigStore,
	connectionId: string,
): Promise<ProviderConfigConnection> {
	const connection = await store.getConnectionById(connectionId);
	if (connection === null) {
		throw routeError({
			code: "provider_connection_not_found",
			message: "Provider connection was not found.",
			status: 404,
		});
	}
	return connection;
}

function summarizeConnection(
	connection: ProviderConfigConnection,
): ProviderConfigConnectionSummary {
	return {
		baseUrl: connection.baseUrl,
		features: [...connection.features],
		featureConfig: structuredClone(connection.featureConfig),
		connectionId: connection.connectionId,
		createdAt: connection.createdAt,
		provider: connection.provider,
		revision: connection.revision,
		secretConfigured: true,
		secretFingerprint: connection.apiKeySecret.fingerprint,
		secretLast4: connection.apiKeySecret.last4,
		updatedAt: connection.updatedAt,
	};
}

async function summarizeProfiles(
	store: ProviderConfigStore,
	profiles: ProviderConfigProfile[],
): Promise<ProviderConfigProfileSummary[]> {
	const summaries: ProviderConfigProfileSummary[] = [];
	for (const profile of profiles) {
		summaries.push(summarizeProfile(profile, await requireConnection(store, profile.connectionId)));
	}
	return summaries;
}

function summarizeProfile(
	profile: ProviderConfigProfile,
	connection: ProviderConfigConnection,
): ProviderConfigProfileSummary {
	return {
		active: profile.active,
		baseUrl: connection.baseUrl,
		connectionId: profile.connectionId,
		createdAt: profile.createdAt,
		dimensions: profile.dimensions,
		kind: profile.kind,
		model: profile.model,
		profileId: profile.profileId,
		provider: connection.provider,
		revision: profile.revision,
		role: profile.role,
		secretConfigured: true,
		secretFingerprint: connection.apiKeySecret.fingerprint,
		secretLast4: connection.apiKeySecret.last4,
		status: profile.status,
		timeoutMs: profile.timeoutMs,
		transport: profile.transport,
		updatedAt: profile.updatedAt,
		validation: profile.validation,
	};
}

function runtimeSnapshotFromProfile(
	profile: ProviderConfigProfile,
	connection: ProviderConfigConnection,
	apiKey: string,
): ProviderConfigRuntimeSnapshot {
	const snapshot: ProviderConfigRuntimeSnapshot = {
		api_key: apiKey,
		base_url: connection.baseUrl,
		feature_config: structuredClone(connection.featureConfig),
		kind: profile.kind,
		model: profile.model,
		profile_id: profile.profileId,
		provider: connection.provider,
		revision: profile.revision,
		role: profile.role,
		timeout_ms: profile.timeoutMs,
		transport: profile.transport,
	};
	if (profile.dimensions !== null) {
		snapshot.dimensions = profile.dimensions;
	}
	return snapshot;
}

function normalizeCreatePayload(payload: ProviderConfigCreatePayload): {
	connectionId: string;
	dimensions: number | null;
	kind: ProviderConfigKind;
	model: string;
	role: ProviderConfigRole;
	timeoutMs: number;
	transport: string;
} {
	const kind = normalizeKind(payload.kind);
	const role = normalizeRole(payload.role, kind);
	const transport = normalizeTransport(payload.transport, kind);
	const dimensions = normalizeDimensions(payload.dimensions, kind);
	return {
		connectionId: normalizeRequiredString(payload.connectionId, "connectionId"),
		dimensions,
		kind,
		model: normalizeRequiredString(payload.model, "model"),
		role,
		timeoutMs: normalizeTimeoutMs(payload.timeoutMs),
		transport,
	};
}

async function normalizeUpdatePayload(
	current: ProviderConfigProfile,
	payload: ProviderConfigUpdatePayload,
): Promise<Partial<ProviderConfigProfile>> {
	const updated: Partial<ProviderConfigProfile> = {};
	if ("connectionId" in payload) {
		updated.connectionId = normalizeRequiredString(payload.connectionId, "connectionId");
	}
	if ("dimensions" in payload) {
		updated.dimensions = normalizeDimensions(payload.dimensions, current.kind);
	}
	if ("model" in payload) {
		updated.model = normalizeRequiredString(payload.model, "model");
	}
	if ("timeoutMs" in payload) {
		updated.timeoutMs = normalizeTimeoutMs(payload.timeoutMs);
	}
	if ("transport" in payload) {
		updated.transport = normalizeTransport(payload.transport, current.kind);
	}
	return updated;
}

function normalizeKind(value: unknown): ProviderConfigKind {
	const normalized = normalizeRequiredString(value, "kind");
	if (normalized !== "prompt" && normalized !== "embedding" && normalized !== "rerank") {
		throw validationError("kind is not supported.", { field: "kind" });
	}
	return normalized;
}

function normalizeRole(value: unknown, kind: ProviderConfigKind): ProviderConfigRole {
	const normalized = normalizeRequiredString(value, "role");
	if (kind === "prompt" && PROMPT_ROLES.has(normalized as PromptProviderRole)) {
		return normalized as PromptProviderRole;
	}
	if (kind === "embedding" && EMBEDDING_ROLES.has(normalized as EmbeddingProviderRole)) {
		return normalized as EmbeddingProviderRole;
	}
	if (kind === "rerank" && RERANK_ROLES.has(normalized as RerankProviderRole)) {
		return normalized as RerankProviderRole;
	}
	throw validationError("role is not supported for provider kind.", { field: "role", kind });
}

function normalizeRuntimeRole(value: string): ProviderConfigRole {
	const normalized = value.trim();
	if (
		PROMPT_ROLES.has(normalized as PromptProviderRole) ||
		EMBEDDING_ROLES.has(normalized as EmbeddingProviderRole) ||
		RERANK_ROLES.has(normalized as RerankProviderRole)
	) {
		return normalized as ProviderConfigRole;
	}
	throw validationError("role is not supported.", { field: "role" });
}

function normalizeProvider(value: unknown): string {
	const provider = normalizeRequiredString(value, "provider");
	if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(provider)) {
		throw validationError("provider must be a lowercase provider slug.", { field: "provider" });
	}
	return provider;
}

function normalizeTransport(value: unknown, kind: ProviderConfigKind): string {
	const transport = normalizeRequiredString(value, "transport");
	if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(transport)) {
		throw validationError("transport must be a lowercase transport slug.", { field: "transport" });
	}
	if (kind === "prompt" && transport !== "responses" && transport !== "chat_completions") {
		throw validationError("transport must be responses or chat_completions.", {
			field: "transport",
		});
	}
	if (kind === "embedding" && transport !== "embeddings" && transport !== "openai_embeddings") {
		throw validationError("transport must be embeddings.", { field: "transport" });
	}
	return transport;
}

function normalizeDimensions(value: unknown, kind: ProviderConfigKind): number | null {
	if (kind === "prompt" || kind === "rerank") {
		return null;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw validationError("dimensions must be a positive integer.", { field: "dimensions" });
	}
	return value;
}

function normalizeConnectionCreatePayload(payload: ProviderConfigConnectionCreatePayload): {
	apiKey: string;
	baseUrl: string;
	features: ProviderConfigFeature[];
	featureConfig: ProviderConfigFeatureConfig;
	provider: string;
} {
	return {
		apiKey: normalizeRequiredString(payload.apiKey, "apiKey"),
		baseUrl: normalizeBaseUrl(payload.baseUrl),
		features: normalizeTools(payload.features),
		featureConfig: normalizeToolConfig(payload.featureConfig),
		provider: normalizeProvider(payload.provider),
	};
}

async function normalizeConnectionUpdatePayload(
	current: ProviderConfigConnection,
	payload: ProviderConfigConnectionUpdatePayload,
	encryptSecret: (plaintext: string) => Promise<string> | string,
): Promise<Partial<ProviderConfigConnection>> {
	const updated: Partial<ProviderConfigConnection> = {};
	if ("apiKey" in payload) {
		updated.apiKeySecret = await secretRefFromPlaintext(
			normalizeRequiredString(payload.apiKey, "apiKey"),
			encryptSecret,
		);
	}
	if ("baseUrl" in payload) {
		updated.baseUrl = normalizeBaseUrl(payload.baseUrl);
	}
	if ("features" in payload) {
		updated.features = normalizeTools(payload.features);
	}
	if ("featureConfig" in payload) {
		updated.featureConfig = normalizeToolConfig(payload.featureConfig);
	}
	if ("provider" in payload) {
		updated.provider = normalizeProvider(payload.provider);
	}
	if (updated.features) {
		for (const feature of current.features) {
			if (!updated.features.includes(feature)) {
				throw validationError("connection features cannot be removed in place.", {
					field: "features",
				});
			}
		}
	}
	return updated;
}

function normalizeTools(value: unknown): ProviderConfigFeature[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw validationError("features must be a non-empty array.", { field: "features" });
	}
	const normalized: ProviderConfigFeature[] = [];
	for (const feature of value) {
		const toolSlug = normalizeRequiredString(feature, "features");
		if (!FEATURES.has(toolSlug as ProviderConfigFeature)) {
			throw validationError("feature is not supported.", { field: "features" });
		}
		if (!normalized.includes(toolSlug as ProviderConfigFeature)) {
			normalized.push(toolSlug as ProviderConfigFeature);
		}
	}
	return normalized;
}

function normalizeToolConfig(value: unknown): ProviderConfigFeatureConfig {
	if (value === undefined || value === null) {
		return {};
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw validationError("featureConfig must be a JSON object.", {
			field: "featureConfig",
		});
	}
	return structuredClone(value as ProviderConfigFeatureConfig);
}

function requireConnectionTool(
	connection: ProviderConfigConnection,
	kind: ProviderConfigKind,
): void {
	if (!connection.features.includes(kind)) {
		throw validationError("connection does not support provider profile kind.", {
			connectionId: connection.connectionId,
			kind,
		});
	}
}

function normalizeTimeoutMs(value: unknown): number {
	if (value === undefined || value === null) {
		return DEFAULT_TIMEOUT_MS;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw validationError("timeoutMs must be a positive integer.", { field: "timeoutMs" });
	}
	return value;
}

function normalizeBaseUrl(value: unknown): string {
	const baseUrl = normalizeRequiredString(value, "baseUrl").replace(/\/+$/, "");
	try {
		const parsed = new URL(baseUrl);
		if (parsed.protocol !== "https:") {
			throw new Error("baseUrl must use https.");
		}
		return parsed.toString().replace(/\/+$/, "");
	} catch {
		throw validationError("baseUrl must be a valid https URL.", { field: "baseUrl" });
	}
}

function normalizeRequiredString(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw validationError(`${field} must be a string.`, { field });
	}
	const normalized = value.trim();
	if (!normalized) {
		throw validationError(`${field} is required.`, { field });
	}
	return normalized;
}

async function secretRefFromPlaintext(
	plaintext: string,
	encryptSecret: (plaintext: string) => Promise<string> | string,
): Promise<ProviderConfigSecretRef> {
	const trimmed = plaintext.trim();
	if (!trimmed) {
		throw validationError("apiKey is required.", { field: "apiKey" });
	}
	return {
		ciphertext: await encryptSecret(trimmed),
		fingerprint: createHash("sha256").update(trimmed).digest("hex"),
		last4: trimmed.slice(-4),
	};
}

async function encryptProviderConfigSecret(
	plaintext: string,
	encryptionKey: string | undefined,
): Promise<string> {
	const key = await providerConfigAesKey(encryptionKey);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt(
		{ iv, name: "AES-GCM" },
		key,
		new TextEncoder().encode(plaintext),
	);
	return `aesgcm:${base64url(iv)}:${base64url(new Uint8Array(encrypted))}`;
}

async function decryptProviderConfigSecret(
	ciphertext: string,
	encryptionKey: string | undefined,
): Promise<string> {
	const [scheme, ivEncoded, payloadEncoded] = ciphertext.split(":");
	if (scheme !== "aesgcm" || !ivEncoded || !payloadEncoded) {
		throw routeError({
			code: "provider_secret_invalid",
			message: "Provider secret ciphertext is invalid.",
			status: 500,
		});
	}
	const key = await providerConfigAesKey(encryptionKey);
	const decrypted = await crypto.subtle.decrypt(
		{ iv: base64urlDecode(ivEncoded), name: "AES-GCM" },
		key,
		base64urlDecode(payloadEncoded),
	);
	return new TextDecoder().decode(decrypted);
}

async function providerConfigAesKey(encryptionKey: string | undefined): Promise<CryptoKey> {
	const secret = encryptionKey?.trim();
	if (!secret) {
		throw routeError({
			code: "provider_config_encryption_key_missing",
			message: "APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY is required.",
			status: 503,
		});
	}
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64url(value: Uint8Array): string {
	return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.from(value, "base64url"));
}
