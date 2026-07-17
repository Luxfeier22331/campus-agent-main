import { createHash, randomUUID } from "node:crypto";

export type ProviderConfigKind = "embedding" | "prompt" | "rerank";
export type ProviderConfigFeature = ProviderConfigKind;
export type ProviderConfigStatus = "draft" | "validation_failed" | "validated";
export type ProviderConfigRole =
	| "eval_judge_llm"
	| "eval_ragas_embedding"
	| "eval_ragas_llm"
	| "hindsight_embedding"
	| "hindsight_llm"
	| "index_embedding"
	| "primary_agent"
	| "rag_query_embedding"
	| "rag_reranker"
	| "rag_synthesis";

export interface ProviderConfigActor {
	displayName: string;
	principalId: string;
}
export interface ProviderConfigSecretRef {
	ciphertext: string;
	fingerprint: string;
	last4: string;
}
export interface ProviderConfigConnection {
	apiKeySecret: ProviderConfigSecretRef;
	baseUrl: string;
	features: ProviderConfigFeature[];
	featureConfig: Record<string, unknown>;
	connectionId: string;
	createdAt: string;
	createdBy: ProviderConfigActor;
	provider: string;
	revision: number;
	updatedAt: string;
	updatedBy: ProviderConfigActor;
}
export interface ProviderConfigValidationResult {
	errorCode?: string;
	message: string;
	observedDimensions?: number;
	ok: boolean;
	status: "failed" | "passed";
	validatedAt?: string;
}
export interface ProviderConfigProfile {
	connectionId: string;
	createdAt: string;
	createdBy: ProviderConfigActor;
	dimensions: number | null;
	kind: ProviderConfigKind;
	model: string;
	profileId: string;
	revision: number;
	role: ProviderConfigRole;
	status: ProviderConfigStatus;
	timeoutMs: number;
	transport: string;
	updatedAt: string;
	updatedBy: ProviderConfigActor;
	validation: ProviderConfigValidationResult | null;
}
export interface ProviderConfigRuntimeProfile {
	api_key: string;
	base_url: string;
	dimensions?: number;
	feature_config?: Record<string, unknown>;
	kind: ProviderConfigKind;
	model: string;
	profile_id: string;
	provider: string;
	revision: number;
	role: ProviderConfigRole;
	timeout_ms: number;
	transport: string;
}
export interface ProviderConfigProjection {
	profiles: Record<string, ProviderConfigRuntimeProfile>;
	publication_id: string;
	published_by: ProviderConfigActor;
	published_at: string;
	schema_version: "provider_config_projection.v2";
}
export interface ProviderConfigConnectionSummary {
	baseUrl: string;
	connectionId: string;
	createdAt: string;
	featureConfig: Record<string, unknown>;
	features: ProviderConfigFeature[];
	provider: string;
	revision: number;
	secretConfigured: boolean;
	secretFingerprint: string;
	secretLast4: string;
	updatedAt: string;
}
export interface ProviderConfigProfileSummary {
	active: boolean;
	baseUrl: string;
	connectionId: string;
	createdAt: string;
	dimensions: number | null;
	kind: ProviderConfigKind;
	model: string;
	profileId: string;
	provider: string;
	revision: number;
	role: ProviderConfigRole;
	status: ProviderConfigStatus;
	timeoutMs: number;
	transport: string;
	updatedAt: string;
	validation: ProviderConfigValidationResult | null;
}
export interface ProviderConfigStore {
	getConnection(id: string): Promise<ProviderConfigConnection | null>;
	getProfile(id: string): Promise<ProviderConfigProfile | null>;
	listConnections(): Promise<ProviderConfigConnection[]>;
	listProfiles(): Promise<ProviderConfigProfile[]>;
	saveConnection(value: ProviderConfigConnection): Promise<void>;
	saveProfile(value: ProviderConfigProfile): Promise<void>;
	verifyReadiness(): Promise<void>;
}

export class ProviderConfigError extends Error {
	readonly code: string;
	readonly status: number;
	readonly details?: Record<string, unknown>;

	constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
		super(message);
		this.name = "ProviderConfigError";
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export function profilePolicyViolation(
	profile: ProviderConfigProfile,
	connection: ProviderConfigConnection,
): ProviderConfigError | null {
	if (!connection.features.includes(profile.kind)) {
		return new ProviderConfigError(
			"provider_profile_connection_incompatible",
			"连接不支持该配置类型。",
			422,
			{ connectionId: connection.connectionId, kind: profile.kind },
		);
	}
	return null;
}

export function runtimeProfile(input: {
	apiKey: string;
	connection: ProviderConfigConnection;
	profile: ProviderConfigProfile;
}): ProviderConfigRuntimeProfile {
	const result: ProviderConfigRuntimeProfile = {
		api_key: input.apiKey,
		base_url: input.connection.baseUrl,
		feature_config: structuredClone(input.connection.featureConfig),
		kind: input.profile.kind,
		model: input.profile.model,
		profile_id: input.profile.profileId,
		provider: input.connection.provider,
		revision: input.profile.revision,
		role: input.profile.role,
		timeout_ms: input.profile.timeoutMs,
		transport: input.profile.transport,
	};
	if (input.profile.dimensions !== null) {
		result.dimensions = input.profile.dimensions;
	}
	return result;
}

const promptRoles = new Set<ProviderConfigRole>([
	"eval_judge_llm",
	"eval_ragas_llm",
	"hindsight_llm",
	"primary_agent",
	"rag_synthesis",
]);
const embeddingRoles = new Set<ProviderConfigRole>([
	"eval_ragas_embedding",
	"hindsight_embedding",
	"index_embedding",
	"rag_query_embedding",
]);
const rerankRoles = new Set<ProviderConfigRole>(["rag_reranker"]);

export function roleForKind(value: string, kind: ProviderConfigKind): ProviderConfigRole | null {
	const roles =
		kind === "prompt" ? promptRoles : kind === "embedding" ? embeddingRoles : rerankRoles;
	return roles.has(value as ProviderConfigRole) ? (value as ProviderConfigRole) : null;
}

export function canonicalProjectionBytes(projection: ProviderConfigProjection): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(projection))}\n`);
}

export function projectionDigest(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function createProjection(input: {
	actor: ProviderConfigActor;
	now?: Date;
	profiles: Record<string, ProviderConfigRuntimeProfile>;
	publicationId?: string;
}): ProviderConfigProjection {
	assertActor(input.actor);
	if (Object.keys(input.profiles).length === 0) {
		throw new Error("provider projection requires profiles");
	}
	for (const [role, profile] of Object.entries(input.profiles)) {
		assertRuntimeProfile(role, profile);
	}
	return {
		profiles: structuredClone(input.profiles),
		publication_id:
			input.publicationId ?? `provider_publication_${randomUUID().replaceAll("-", "")}`,
		published_by: structuredClone(input.actor),
		published_at: (input.now ?? new Date()).toISOString(),
		schema_version: "provider_config_projection.v2",
	};
}

export function parseProviderConfigProjection(value: unknown): ProviderConfigProjection {
	const projection = record(value, "provider projection");
	assertExactKeys(projection, [
		"profiles",
		"publication_id",
		"published_at",
		"published_by",
		"schema_version",
	]);
	if (projection.schema_version !== "provider_config_projection.v2") {
		throw new Error("provider projection schema_version is unsupported");
	}
	const publicationId = nonEmptyString(projection.publication_id, "publication_id", 128);
	const publishedAt = nonEmptyString(projection.published_at, "published_at");
	if (Number.isNaN(Date.parse(publishedAt))) {
		throw new Error("provider projection published_at is invalid");
	}
	const publishedByValue = record(projection.published_by, "published_by");
	assertExactKeys(publishedByValue, ["displayName", "principalId"]);
	const publishedBy = {
		displayName: nonEmptyString(publishedByValue.displayName, "published_by.displayName"),
		principalId: nonEmptyString(publishedByValue.principalId, "published_by.principalId"),
	};
	const profileValues = record(projection.profiles, "profiles");
	if (Object.keys(profileValues).length === 0) {
		throw new Error("provider projection requires profiles");
	}
	const profiles: Record<string, ProviderConfigRuntimeProfile> = {};
	for (const [role, profileValue] of Object.entries(profileValues)) {
		const profile = parseRuntimeProfile(profileValue);
		assertRuntimeProfile(role, profile);
		profiles[role] = profile;
	}
	return {
		profiles,
		publication_id: publicationId,
		published_at: publishedAt,
		published_by: publishedBy,
		schema_version: "provider_config_projection.v2",
	};
}

function parseRuntimeProfile(value: unknown): ProviderConfigRuntimeProfile {
	const profile = record(value, "provider profile");
	const requiredKeys = [
		"api_key",
		"base_url",
		"kind",
		"model",
		"profile_id",
		"provider",
		"revision",
		"role",
		"timeout_ms",
		"transport",
	];
	assertExactKeys(profile, [...requiredKeys, "dimensions", "feature_config"], true);
	const missing = requiredKeys.filter((key) => !(key in profile));
	if (missing.length > 0) {
		throw new Error(`missing provider projection field: ${missing[0]}`);
	}
	const kind = profile.kind;
	if (kind !== "embedding" && kind !== "prompt" && kind !== "rerank") {
		throw new Error("provider profile kind is invalid");
	}
	const role = nonEmptyString(profile.role, "role") as ProviderConfigRole;
	if (!roleForKind(role, kind)) {
		throw new Error(`provider profile role is invalid: ${role}`);
	}
	const baseUrl = nonEmptyString(profile.base_url, "base_url");
	try {
		if (new URL(baseUrl).protocol !== "https:") {
			throw new Error("provider URL must use HTTPS");
		}
	} catch {
		throw new Error("provider profile base_url must be HTTPS");
	}
	const result: ProviderConfigRuntimeProfile = {
		api_key: nonEmptyString(profile.api_key, "api_key"),
		base_url: baseUrl,
		kind,
		model: nonEmptyString(profile.model, "model"),
		profile_id: nonEmptyString(profile.profile_id, "profile_id"),
		provider: nonEmptyString(profile.provider, "provider"),
		revision: positiveInteger(profile.revision, "revision"),
		role,
		timeout_ms: positiveInteger(profile.timeout_ms, "timeout_ms"),
		transport: nonEmptyString(profile.transport, "transport"),
	};
	if (profile.dimensions !== undefined) {
		result.dimensions = positiveInteger(profile.dimensions, "dimensions");
	}
	if (profile.feature_config !== undefined) {
		result.feature_config = structuredClone(record(profile.feature_config, "feature_config"));
	}
	return result;
}

function assertRuntimeProfile(role: string, profile: ProviderConfigRuntimeProfile): void {
	if (role !== profile.role) {
		throw new Error(`provider projection role mismatch: ${role}`);
	}
	if (
		!(
			profile.api_key.trim() &&
			profile.model.trim() &&
			profile.profile_id.trim() &&
			profile.provider.trim()
		)
	) {
		throw new Error(`provider projection profile ${role} is incomplete`);
	}
	try {
		if (new URL(profile.base_url).protocol !== "https:") {
			throw new Error("provider URL must use HTTPS");
		}
	} catch {
		throw new Error(`provider projection profile ${role} base_url must be HTTPS`);
	}
	if (!Number.isInteger(profile.revision) || profile.revision < 1) {
		throw new Error(`provider projection profile ${role} revision is invalid`);
	}
	if (!Number.isInteger(profile.timeout_ms) || profile.timeout_ms < 1) {
		throw new Error(`provider projection profile ${role} timeout_ms is invalid`);
	}
	if (profile.kind === "embedding" && (!profile.dimensions || profile.dimensions < 1)) {
		throw new Error(`embedding profile ${role} requires dimensions`);
	}
	if (profile.kind !== "embedding" && profile.dimensions !== undefined) {
		throw new Error(`${profile.kind} profile ${role} must not define dimensions`);
	}
	if (!roleForKind(profile.role, profile.kind)) {
		throw new Error(`provider projection role is invalid: ${role}`);
	}
	const validTransport =
		profile.kind === "prompt"
			? profile.transport === "responses" || profile.transport === "chat_completions"
			: profile.kind === "embedding"
				? profile.transport === "embeddings" || profile.transport === "openai_embeddings"
				: profile.transport === "rerank" || profile.transport === "gitee_rerank";
	if (!validTransport) {
		throw new Error(`provider projection profile ${role} transport is invalid`);
	}
}

function assertActor(value: ProviderConfigActor): void {
	nonEmptyString(value.displayName, "published_by.displayName");
	nonEmptyString(value.principalId, "published_by.principalId");
}

function assertExactKeys(
	value: Record<string, unknown>,
	allowed: string[],
	allowMissingOptional = false,
): void {
	const allowedKeys = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
	if (unknown.length > 0) {
		throw new Error(`unexpected provider projection field: ${unknown[0]}`);
	}
	if (!allowMissingOptional) {
		const missing = allowed.filter((key) => !(key in value));
		if (missing.length > 0) {
			throw new Error(`missing provider projection field: ${missing[0]}`);
		}
	}
}

function record(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string, maxLength = 2_048): string {
	if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
		throw new Error(`provider projection ${field} is invalid`);
	}
	return value;
}

function positiveInteger(value: unknown, field: string): number {
	if (!Number.isInteger(value) || (value as number) < 1) {
		throw new Error(`provider projection ${field} is invalid`);
	}
	return value as number;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJson);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, sortJson(item)]),
		);
	}
	return value;
}
