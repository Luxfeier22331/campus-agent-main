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
	RawCaptureField,
	RawCapturePolicy,
	RawCapturePolicyMode,
	RawCaptureRequestScope,
	RawCaptureSink,
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
		async getRuntimeSnapshot(input = {}) {
			const config = (await dependencies.store.getActive()) ?? defaultConfig(now());
			return { config: await runtimeSnapshotFromConfig(config, decryptSecret, input.scope) };
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
	if ("rawCapturePolicy" in payload) {
		next.rawCapturePolicy = normalizeRawCapturePolicy(payload.rawCapturePolicy);
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
		validateRawModelIOAdmission(config);
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
	validateRawModelIOAdmission(config);
}

async function runtimeSnapshotFromConfig(
	config: LlmDebugTraceConfig,
	decryptSecret: (ciphertext: string) => Promise<string> | string,
	scope?: RawCaptureRequestScope,
): Promise<LlmDebugTraceRuntimeSnapshot> {
	validateCompleteConfig(config);
	const rawCapturePolicy = scopedRuntimeRawCapturePolicy(config.rawCapturePolicy, scope);
	const snapshot: LlmDebugTraceRuntimeSnapshot = {
		include_model_io: config.includeModelIo,
		mode: config.mode,
		sample_ratio: config.sampleRatio,
		schema_version: "llm_debug_trace_config.v1",
	};
	if (rawCapturePolicy) {
		snapshot.raw_capture_policy = rawCapturePolicy;
	}
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

function scopedRuntimeRawCapturePolicy(
	policy: RawCapturePolicy | undefined,
	scope: RawCaptureRequestScope | undefined,
): RawCapturePolicy | undefined {
	if (!policy) {
		return;
	}
	if (policy.mode === "off") {
		return policy;
	}
	if (scope) {
		assertRawCapturePolicyScopeMatches(policy, scope, "rawCapturePolicy");
	}
	return policy;
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
		rawCapturePolicy: config.rawCapturePolicy,
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

function normalizeIncludeModelIo(value: unknown): boolean {
	if (value === true || value === false) {
		return value;
	}
	throw routeError({
		code: "validation_failed",
		message: "includeModelIo must be a boolean.",
		status: 422,
	});
}

const RAW_CAPTURE_POLICY_MODES = new Set<RawCapturePolicyMode>([
	"eval_case",
	"failure_triggered",
	"manual_run_capture",
	"off",
	"operator_window",
	"sampled",
]);

const RAW_CAPTURE_SINKS = new Set<RawCaptureSink>([
	"langfuse_otlp",
	"openai_agents_trace",
	"s3_replay_packet",
]);

const RAW_CAPTURE_FIELDS = new Set<RawCaptureField>([
	"output_schema",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"rendered_messages",
	"selected_evidence_packet",
	"selected_memory_context",
	"tool_calls",
	"tool_results",
]);

const MODEL_IO_RAW_FIELDS = new Set<RawCaptureField>([
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"rendered_messages",
]);

const MODEL_IO_RAW_SINKS = new Set<RawCaptureSink>(["langfuse_otlp", "openai_agents_trace"]);

function normalizeRawCapturePolicy(value: unknown): RawCapturePolicy | undefined {
	if (value === undefined || value === null) {
		return;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy must be a raw_capture_policy.v1 object.",
			status: 422,
		});
	}
	const record = value as Record<string, unknown>;
	if (record.schema_version !== "raw_capture_policy.v1") {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy.schema_version must be raw_capture_policy.v1.",
			status: 422,
		});
	}
	const mode = normalizeEnum(record.mode, RAW_CAPTURE_POLICY_MODES, "rawCapturePolicy.mode");
	const policy: RawCapturePolicy = {
		allowed_raw_fields: normalizeUniqueEnumList(
			record.allowed_raw_fields,
			RAW_CAPTURE_FIELDS,
			"rawCapturePolicy.allowed_raw_fields",
		),
		allowed_sinks: normalizeUniqueEnumList(
			record.allowed_sinks,
			RAW_CAPTURE_SINKS,
			"rawCapturePolicy.allowed_sinks",
		),
		approval_ref: normalizeNullableString(record.approval_ref, "rawCapturePolicy.approval_ref"),
		audit_required: normalizeBoolean(record.audit_required, "rawCapturePolicy.audit_required"),
		capture_reason: normalizeRequiredString(
			record.capture_reason,
			"rawCapturePolicy.capture_reason",
		),
		dsar_delete_linkage_required: normalizeBoolean(
			record.dsar_delete_linkage_required,
			"rawCapturePolicy.dsar_delete_linkage_required",
		),
		mode,
		operator_principal: normalizeNullableString(
			record.operator_principal,
			"rawCapturePolicy.operator_principal",
		),
		request_id: normalizeNullableString(record.request_id, "rawCapturePolicy.request_id"),
		run_id: normalizeNullableString(record.run_id, "rawCapturePolicy.run_id"),
		schema_version: "raw_capture_policy.v1",
		ttl_days: normalizeRawCaptureTtlDays(record.ttl_days, mode),
		trace_id: normalizeNullableString(record.trace_id, "rawCapturePolicy.trace_id"),
	};
	validateRawCapturePolicy(policy);
	return policy;
}

function validateRawCapturePolicy(policy: RawCapturePolicy): void {
	if (policy.mode === "off") {
		if (
			policy.ttl_days !== 0 ||
			policy.allowed_sinks.length > 0 ||
			policy.allowed_raw_fields.length > 0 ||
			policy.operator_principal !== null ||
			policy.approval_ref !== null ||
			policy.request_id !== null ||
			policy.run_id !== null ||
			policy.trace_id !== null ||
			policy.audit_required ||
			policy.dsar_delete_linkage_required
		) {
			throw routeError({
				code: "validation_failed",
				message: "rawCapturePolicy mode off must not admit raw capture.",
				status: 422,
			});
		}
		return;
	}
	if (policy.ttl_days <= 0) {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy.ttl_days must be a positive integer when mode is not off.",
			status: 422,
		});
	}
	if (policy.allowed_sinks.length === 0) {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy.allowed_sinks must not be empty when mode is not off.",
			status: 422,
		});
	}
	if (policy.allowed_raw_fields.length === 0) {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy.allowed_raw_fields must not be empty when mode is not off.",
			status: 422,
		});
	}
	if (!(policy.operator_principal && policy.approval_ref)) {
		throw routeError({
			code: "validation_failed",
			message:
				"rawCapturePolicy requires operator_principal and approval_ref when mode is not off.",
			status: 422,
		});
	}
	if (!(policy.audit_required && policy.dsar_delete_linkage_required)) {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy requires audit and deletion linkage when mode is not off.",
			status: 422,
		});
	}
	if (!(policy.request_id && policy.run_id && policy.trace_id)) {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy requires request_id, run_id, and trace_id when mode is not off.",
			status: 422,
		});
	}
}

function assertRawCapturePolicyScopeMatches(
	policy: RawCapturePolicy,
	scope: RawCaptureRequestScope,
	field: string,
): void {
	const checks = [
		{ actual: policy.request_id, expected: scope.requestId, suffix: "request_id" },
		{ actual: policy.run_id, expected: scope.runId, suffix: "run_id" },
		{ actual: policy.trace_id, expected: scope.traceId, suffix: "trace_id" },
	];
	for (const check of checks) {
		if (check.actual !== check.expected) {
			throw routeError({
				code: "validation_failed",
				message: `${field}.${check.suffix} must match runtime snapshot scope.`,
				status: 422,
			});
		}
	}
}

function validateRawModelIOAdmission(config: LlmDebugTraceConfig): void {
	if (!config.includeModelIo) {
		return;
	}
	const policy = config.rawCapturePolicy;
	if (!policy || policy.mode === "off") {
		throw routeError({
			code: "validation_failed",
			message: "includeModelIo=true requires an admitted raw_capture_policy.v1.",
			status: 422,
		});
	}
	if (!policy.allowed_sinks.some((sink) => MODEL_IO_RAW_SINKS.has(sink))) {
		throw routeError({
			code: "validation_failed",
			message: "includeModelIo=true requires a raw capture sink for model IO.",
			status: 422,
		});
	}
	if (!policy.allowed_raw_fields.some((field) => MODEL_IO_RAW_FIELDS.has(field))) {
		throw routeError({
			code: "validation_failed",
			message: "includeModelIo=true requires an allowed raw model IO field.",
			status: 422,
		});
	}
}

function normalizeUniqueEnumList<T extends string>(
	value: unknown,
	allowed: ReadonlySet<T>,
	field: string,
): T[] {
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			message: `${field} must be an array.`,
			status: 422,
		});
	}
	const seen = new Set<T>();
	for (const item of value) {
		const normalized = normalizeEnum(item, allowed, field);
		if (seen.has(normalized)) {
			throw routeError({
				code: "validation_failed",
				message: `${field} must not contain duplicates.`,
				status: 422,
			});
		}
		seen.add(normalized);
	}
	return [...seen];
}

function normalizeEnum<T extends string>(
	value: unknown,
	allowed: ReadonlySet<T>,
	field: string,
): T {
	if (typeof value !== "string" || !allowed.has(value as T)) {
		throw routeError({
			code: "validation_failed",
			message: `${field} is unsupported.`,
			status: 422,
		});
	}
	return value as T;
}

function normalizeNullableString(value: unknown, field: string): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	return normalizeRequiredString(value, field);
}

function normalizeBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") {
		throw routeError({
			code: "validation_failed",
			message: `${field} must be a boolean.`,
			status: 422,
		});
	}
	return value;
}

function normalizeInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw routeError({
			code: "validation_failed",
			message: `${field} must be an integer.`,
			status: 422,
		});
	}
	return value;
}

function normalizeRawCaptureTtlDays(value: unknown, mode: RawCapturePolicyMode): number {
	if (mode !== "off" && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
		throw routeError({
			code: "validation_failed",
			message: "rawCapturePolicy.ttl_days must be a positive integer when mode is not off.",
			status: 422,
		});
	}
	return normalizeInteger(value, "rawCapturePolicy.ttl_days");
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
