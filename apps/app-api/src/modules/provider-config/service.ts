import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ProviderConfigStore } from "./store";
import type {
	EmbeddingProviderRole,
	PromptProviderRole,
	ProviderConfigActor,
	ProviderConfigCreatePayload,
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
} from "./types";

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
	"memory_graph_llm",
	"primary_agent",
	"rag_synthesis",
]);
const EMBEDDING_ROLES = new Set<EmbeddingProviderRole>(["index_embedding", "rag_query_embedding"]);
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
	};

	return {
		async activateProfile(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const profile = await requireProfile(dependencies.store, input.profileId);
			if (!profile.validation?.ok) {
				throw routeError({
					code: "provider_profile_not_validated",
					message: "Provider profile must pass validation before activation.",
					status: 409,
				});
			}
			if (profile.kind === "embedding") {
				const rawApiKey = await decryptSecret(profile.apiKeySecret.ciphertext);
				const compatibility = await validators.checkEmbeddingCompatibility({
					profile,
					rawApiKey,
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
			return { profile: summarizeProfile(activated) };
		},
		async createProfile(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const normalized = normalizeCreatePayload(input.payload);
			const createdAt = now().toISOString();
			const apiKeySecret = await secretRefFromPlaintext(normalized.apiKey, encryptSecret);
			const profile: ProviderConfigProfile = {
				active: false,
				apiKeySecret,
				baseUrl: normalized.baseUrl,
				createdAt,
				createdBy: actor,
				dimensions: normalized.dimensions,
				kind: normalized.kind,
				model: normalized.model,
				profileId: generateId("provider_profile"),
				provider: normalized.provider,
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
			return { profile: summarizeProfile(profile) };
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
			return {
				profile: runtimeSnapshotFromProfile(
					profile,
					await decryptSecret(profile.apiKeySecret.ciphertext),
				),
			};
		},
		async listProfiles(input) {
			ensureOperatorPrincipal(input.principal);
			return { profiles: (await dependencies.store.list()).map(summarizeProfile) };
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
			const normalized = await normalizeUpdatePayload(
				current,
				input.payload,
				decryptSecret,
				encryptSecret,
			);
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
			return { profile: summarizeProfile(updated) };
		},
		async validateProfile(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const current = await requireProfile(dependencies.store, input.profileId);
			const apiKey = await decryptSecret(current.apiKeySecret.ciphertext);
			const validatorInput = {
				apiKey,
				baseUrl: current.baseUrl,
				dimensions: current.dimensions,
				model: current.model,
				provider: current.provider,
				role: current.role,
				timeoutMs: current.timeoutMs,
				transport: current.transport,
			};
			const validation =
				current.kind === "embedding"
					? await validators.validateEmbedding(validatorInput)
					: await validators.validatePrompt(validatorInput);
			const withTimestamp: ProviderConfigValidationResult = {
				...validation,
				validatedAt: validation.validatedAt ?? now().toISOString(),
			};
			const next: ProviderConfigProfile = {
				...current,
				revision: current.revision + 1,
				status: withTimestamp.ok ? "validated" : "validation_failed",
				updatedAt: now().toISOString(),
				updatedBy: actor,
				validation: withTimestamp,
			};
			await dependencies.store.save(next);
			return { profile: summarizeProfile(next), validation: withTimestamp };
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

function summarizeProfile(profile: ProviderConfigProfile): ProviderConfigProfileSummary {
	return {
		active: profile.active,
		baseUrl: profile.baseUrl,
		createdAt: profile.createdAt,
		dimensions: profile.dimensions,
		kind: profile.kind,
		model: profile.model,
		profileId: profile.profileId,
		provider: profile.provider,
		revision: profile.revision,
		role: profile.role,
		secretConfigured: true,
		secretFingerprint: profile.apiKeySecret.fingerprint,
		secretLast4: profile.apiKeySecret.last4,
		status: profile.status,
		timeoutMs: profile.timeoutMs,
		transport: profile.transport,
		updatedAt: profile.updatedAt,
		validation: profile.validation,
	};
}

function runtimeSnapshotFromProfile(
	profile: ProviderConfigProfile,
	apiKey: string,
): ProviderConfigRuntimeSnapshot {
	const snapshot: ProviderConfigRuntimeSnapshot = {
		api_key: apiKey,
		base_url: profile.baseUrl,
		model: profile.model,
		profile_id: profile.profileId,
		provider: profile.provider,
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
	apiKey: string;
	baseUrl: string;
	dimensions: number | null;
	kind: ProviderConfigKind;
	model: string;
	provider: string;
	role: ProviderConfigRole;
	timeoutMs: number;
	transport: string;
} {
	const kind = normalizeKind(payload.kind);
	const role = normalizeRole(payload.role, kind);
	const transport = normalizeTransport(payload.transport, kind);
	const dimensions = normalizeDimensions(payload.dimensions, kind);
	return {
		apiKey: normalizeRequiredString(payload.apiKey, "apiKey"),
		baseUrl: normalizeBaseUrl(payload.baseUrl),
		dimensions,
		kind,
		model: normalizeRequiredString(payload.model, "model"),
		provider: normalizeProvider(payload.provider),
		role,
		timeoutMs: normalizeTimeoutMs(payload.timeoutMs),
		transport,
	};
}

async function normalizeUpdatePayload(
	current: ProviderConfigProfile,
	payload: ProviderConfigUpdatePayload,
	decryptSecret: (ciphertext: string) => Promise<string> | string,
	encryptSecret: (plaintext: string) => Promise<string> | string,
): Promise<Partial<ProviderConfigProfile>> {
	const updated: Partial<ProviderConfigProfile> = {};
	if ("apiKey" in payload) {
		updated.apiKeySecret = await secretRefFromPlaintext(
			normalizeRequiredString(payload.apiKey, "apiKey"),
			encryptSecret,
		);
	}
	if ("baseUrl" in payload) {
		updated.baseUrl = normalizeBaseUrl(payload.baseUrl);
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
	if (updated.apiKeySecret === undefined && current.apiKeySecret.ciphertext.trim() === "") {
		const apiKey = await decryptSecret(current.apiKeySecret.ciphertext);
		updated.apiKeySecret = await secretRefFromPlaintext(apiKey, encryptSecret);
	}
	return updated;
}

function normalizeKind(value: unknown): ProviderConfigKind {
	const normalized = normalizeRequiredString(value, "kind");
	if (normalized !== "prompt" && normalized !== "embedding") {
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
	throw validationError("role is not supported for provider kind.", { field: "role", kind });
}

function normalizeRuntimeRole(value: string): ProviderConfigRole {
	const normalized = value.trim();
	if (
		PROMPT_ROLES.has(normalized as PromptProviderRole) ||
		EMBEDDING_ROLES.has(normalized as EmbeddingProviderRole)
	) {
		return normalized as ProviderConfigRole;
	}
	throw validationError("role is not supported.", { field: "role" });
}

function normalizeProvider(value: unknown): string {
	const provider = normalizeRequiredString(value, "provider");
	if (provider !== "openai") {
		throw validationError("provider is not supported.", { field: "provider" });
	}
	return provider;
}

function normalizeTransport(value: unknown, kind: ProviderConfigKind): string {
	const transport = normalizeRequiredString(value, "transport");
	const expected = kind === "embedding" ? "embeddings" : "responses";
	if (transport !== expected) {
		throw validationError(`transport must be ${expected}.`, { field: "transport" });
	}
	return transport;
}

function normalizeDimensions(value: unknown, kind: ProviderConfigKind): number | null {
	if (kind === "prompt") {
		return null;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw validationError("dimensions must be a positive integer.", { field: "dimensions" });
	}
	return value;
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

async function defaultValidatePromptProvider(
	input: Parameters<ProviderConfigValidators["validatePrompt"]>[0],
): Promise<ProviderConfigValidationResult> {
	try {
		const response = await fetch(`${input.baseUrl}/responses`, {
			body: JSON.stringify({
				input: "provider config validation",
				max_output_tokens: 8,
				model: input.model,
			}),
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(input.timeoutMs),
		});
		if (!response.ok) {
			return {
				errorCode: "provider_http_error",
				message: `prompt provider validation returned HTTP ${response.status}`,
				ok: false,
				status: "failed",
			};
		}
		return { message: "prompt provider validated", ok: true, status: "passed" };
	} catch (error) {
		return {
			errorCode: "provider_request_failed",
			message: error instanceof Error ? error.message : String(error),
			ok: false,
			status: "failed",
		};
	}
}

async function defaultValidateEmbeddingProvider(
	input: Parameters<ProviderConfigValidators["validateEmbedding"]>[0],
): Promise<ProviderConfigValidationResult> {
	try {
		const response = await fetch(`${input.baseUrl}/embeddings`, {
			body: JSON.stringify({
				dimensions: input.dimensions,
				input: "provider config validation",
				model: input.model,
			}),
			headers: {
				authorization: `Bearer ${input.apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(input.timeoutMs),
		});
		if (!response.ok) {
			return {
				errorCode: "provider_http_error",
				message: `embedding provider validation returned HTTP ${response.status}`,
				ok: false,
				status: "failed",
			};
		}
		const payload = (await response.json()) as {
			data?: Array<{ embedding?: unknown[] }>;
		};
		const observedDimensions = payload.data?.[0]?.embedding?.length ?? 0;
		if (observedDimensions <= 0) {
			return {
				errorCode: "embedding_response_empty",
				message: "embedding provider response did not include an embedding.",
				ok: false,
				status: "failed",
			};
		}
		if (input.dimensions !== null && observedDimensions !== input.dimensions) {
			return {
				errorCode: "embedding_dimensions_mismatch",
				message: `embedding dimensions mismatch: expected ${input.dimensions}, got ${observedDimensions}`,
				observedDimensions,
				ok: false,
				status: "failed",
			};
		}
		return {
			message: "embedding provider validated",
			observedDimensions,
			ok: true,
			status: "passed",
		};
	} catch (error) {
		return {
			errorCode: "provider_request_failed",
			message: error instanceof Error ? error.message : String(error),
			ok: false,
			status: "failed",
		};
	}
}

async function defaultEmbeddingCompatibilityCheck() {
	return {
		ok: false,
		reason: "Embedding compatibility checker is not configured.",
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
