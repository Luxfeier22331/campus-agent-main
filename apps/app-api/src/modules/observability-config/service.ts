import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ProviderConfigActor } from "../provider-config";
import { decryptAppApiSecret, encryptAppApiSecret, secretRefFromPlaintext } from "../secret-crypto";
import type { ObservabilityConfigStore } from "./store";
import type {
	LlmDebugTraceConfig,
	LlmDebugTraceConfigSummary,
	LlmDebugTraceMode,
	LlmDebugTraceRuntimeSnapshot,
	ObservabilityConfigService,
	ObservabilityConfigUpdatePayload,
} from "./types";

export interface ObservabilityConfigServiceDependencies {
	decryptSecret?: (ciphertext: string) => Promise<string> | string;
	encryptionKey?: string;
	encryptSecret?: (plaintext: string) => Promise<string> | string;
	now?: () => Date;
	store: ObservabilityConfigStore;
}

const ACTIVE_CONFIG_ID = "active";

export function buildObservabilityConfigService(
	dependencies: ObservabilityConfigServiceDependencies,
): ObservabilityConfigService {
	const now = dependencies.now ?? (() => new Date());
	const encryptSecret =
		dependencies.encryptSecret ??
		((value: string) => encryptObservabilitySecret(value, dependencies.encryptionKey));
	const decryptSecret =
		dependencies.decryptSecret ??
		((value: string) => decryptObservabilitySecret(value, dependencies.encryptionKey));

	return {
		async getConfig(input) {
			ensureOperatorPrincipal(input.principal);
			return {
				config: summarizeConfig((await dependencies.store.getActive()) ?? defaultConfig(now())),
			};
		},
		async getRuntimeSnapshot() {
			const config = (await dependencies.store.getActive()) ?? defaultConfig(now());
			return { config: await runtimeSnapshotFromConfig(config, decryptSecret) };
		},
		async updateConfig(input) {
			const actor = ensureOperatorPrincipal(input.principal);
			const current = (await dependencies.store.getActive()) ?? defaultConfig(now());
			const normalized = await normalizeUpdatePayload(input.payload, current, encryptSecret);
			const updated: LlmDebugTraceConfig = {
				...current,
				...normalized,
				configId: ACTIVE_CONFIG_ID,
				revision: current.revision + 1,
				updatedAt: now().toISOString(),
				updatedBy: actor,
			};
			validateCompleteConfig(updated);
			await dependencies.store.save(updated);
			return { config: summarizeConfig(updated) };
		},
	};
}

function defaultConfig(now: Date): LlmDebugTraceConfig {
	return {
		configId: ACTIVE_CONFIG_ID,
		includeModelIo: false,
		mode: "off",
		revision: 0,
		sampleRatio: 1,
		updatedAt: now.toISOString(),
		updatedBy: { displayName: "system", principalId: "system" },
	};
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
			message: "Observability config requires a stable operator principal id.",
			status: 403,
		});
	}
	return {
		displayName: principal.principal.displayName.trim() || principalId,
		principalId,
	};
}

async function normalizeUpdatePayload(
	payload: ObservabilityConfigUpdatePayload,
	current: LlmDebugTraceConfig,
	encryptSecret: (plaintext: string) => Promise<string> | string,
): Promise<Partial<LlmDebugTraceConfig>> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw routeError({
			code: "validation_failed",
			message: "Observability config payload must be an object.",
			status: 422,
		});
	}
	const next: Partial<LlmDebugTraceConfig> = {};
	if ("mode" in payload) {
		next.mode = normalizeMode(payload.mode);
	}
	if ("includeModelIo" in payload) {
		next.includeModelIo = normalizeIncludeModelIo(payload.includeModelIo);
	}
	if ("sampleRatio" in payload) {
		next.sampleRatio = normalizeSampleRatio(payload.sampleRatio);
	}
	if ("otlpEndpoint" in payload) {
		next.otlpEndpoint = normalizeOptionalUrl(payload.otlpEndpoint, "otlpEndpoint");
	}
	if ("publicTraceBaseUrl" in payload) {
		next.publicTraceBaseUrl = normalizeOptionalUrl(
			payload.publicTraceBaseUrl,
			"publicTraceBaseUrl",
		);
	}
	if ("authHeader" in payload) {
		const authHeader = normalizeRequiredString(payload.authHeader, "authHeader");
		validateAuthHeader(authHeader);
		next.authHeaderSecret = await secretRefFromPlaintext(authHeader, encryptSecret);
	}
	validateCompleteConfig({ ...current, ...next, configId: ACTIVE_CONFIG_ID });
	return next;
}

function validateCompleteConfig(config: LlmDebugTraceConfig): void {
	if (config.mode === "off") {
		return;
	}
	if (config.mode !== "langfuse_otlp") {
		throw routeError({
			code: "validation_failed",
			message: "Unsupported LLM debug trace mode.",
			status: 422,
		});
	}
	if (!config.otlpEndpoint?.trim()) {
		throw routeError({
			code: "validation_failed",
			message: "otlpEndpoint is required when LLM debug trace mode is langfuse_otlp.",
			status: 422,
		});
	}
	validateLangfuseOtlpEndpoint(config.otlpEndpoint);
	if (!config.authHeaderSecret) {
		throw routeError({
			code: "validation_failed",
			message: "authHeader is required when LLM debug trace mode is langfuse_otlp.",
			status: 422,
		});
	}
	if (config.sampleRatio < 0 || config.sampleRatio > 1) {
		throw routeError({
			code: "validation_failed",
			message: "sampleRatio must be between 0 and 1.",
			status: 422,
		});
	}
}

async function runtimeSnapshotFromConfig(
	config: LlmDebugTraceConfig,
	decryptSecret: (ciphertext: string) => Promise<string> | string,
): Promise<LlmDebugTraceRuntimeSnapshot> {
	validateCompleteConfig(config);
	const snapshot: LlmDebugTraceRuntimeSnapshot = {
		include_model_io: config.includeModelIo,
		mode: config.mode,
		sample_ratio: config.sampleRatio,
		schema_version: "llm_debug_trace_config.v1",
	};
	if (config.mode === "langfuse_otlp") {
		const authHeader = await decryptSecret(config.authHeaderSecret?.ciphertext ?? "");
		validateAuthHeader(authHeader);
		snapshot.langfuse_otlp = {
			auth_header: authHeader,
			endpoint: config.otlpEndpoint ?? "",
			public_trace_base_url: config.publicTraceBaseUrl,
		};
	}
	return snapshot;
}

function summarizeConfig(config: LlmDebugTraceConfig): LlmDebugTraceConfigSummary {
	return {
		authHeaderConfigured: config.authHeaderSecret !== undefined,
		authHeaderFingerprint: config.authHeaderSecret?.fingerprint,
		authHeaderLast4: config.authHeaderSecret?.last4,
		configId: ACTIVE_CONFIG_ID,
		includeModelIo: config.includeModelIo,
		mode: config.mode,
		otlpEndpoint: config.otlpEndpoint,
		publicTraceBaseUrl: config.publicTraceBaseUrl,
		revision: config.revision,
		sampleRatio: config.sampleRatio,
		updatedAt: config.updatedAt,
		updatedBy: config.updatedBy,
	};
}

function normalizeMode(value: unknown): LlmDebugTraceMode {
	if (value === "off" || value === "langfuse_otlp") {
		return value;
	}
	throw routeError({
		code: "validation_failed",
		message: "mode must be off or langfuse_otlp.",
		status: 422,
	});
}

function normalizeIncludeModelIo(value: unknown): false {
	if (value === false) {
		return false;
	}
	throw routeError({
		code: "validation_failed",
		message: "includeModelIo is currently fixed to false.",
		status: 422,
	});
}

function normalizeSampleRatio(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		throw routeError({
			code: "validation_failed",
			message: "sampleRatio must be between 0 and 1.",
			status: 422,
		});
	}
	return value;
}

function normalizeOptionalUrl(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null || value === "") {
		return;
	}
	const normalized = normalizeRequiredString(value, field);
	try {
		const url = new URL(normalized);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("unsupported protocol");
		}
		return normalized.replace(/\/+$/u, "");
	} catch {
		throw routeError({
			code: "validation_failed",
			message: `${field} must be an absolute http(s) URL.`,
			status: 422,
		});
	}
}

function normalizeRequiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw routeError({
			code: "validation_failed",
			message: `${field} is required.`,
			status: 422,
		});
	}
	return value.trim();
}

function validateAuthHeader(value: string): void {
	if (!value.startsWith("Basic ")) {
		throw routeError({
			code: "validation_failed",
			message: "authHeader must use Basic authentication for Langfuse OTLP.",
			status: 422,
		});
	}
}

function validateLangfuseOtlpEndpoint(value: string): void {
	if (!value.trim().replace(/\/+$/u, "").endsWith("/api/public/otel")) {
		throw routeError({
			code: "validation_failed",
			message: "otlpEndpoint must be a Langfuse OTLP base endpoint ending with /api/public/otel.",
			status: 422,
		});
	}
}

async function encryptObservabilitySecret(value: string, encryptionKey?: string): Promise<string> {
	return encryptAppApiSecret(value, encryptionKey, {
		invalidCiphertextCode: "observability_config_secret_invalid",
		invalidCiphertextMessage: "Observability config secret ciphertext is invalid.",
		missingKeyCode: "observability_config_encryption_key_missing",
		missingKeyMessage: "APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY is required.",
	});
}

async function decryptObservabilitySecret(value: string, encryptionKey?: string): Promise<string> {
	return decryptAppApiSecret(value, encryptionKey, {
		invalidCiphertextCode: "observability_config_secret_invalid",
		invalidCiphertextMessage: "Observability config secret ciphertext is invalid.",
		missingKeyCode: "observability_config_encryption_key_missing",
		missingKeyMessage: "APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY is required.",
	});
}

function routeError(input: { code: string; message: string; status: number }): AppApiRouteError {
	return new AppApiRouteError({
		...input,
		retryable: false,
	});
}
