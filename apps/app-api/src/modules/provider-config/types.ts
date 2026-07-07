import type { ResolvedAppPrincipal } from "../auth";

export type ProviderConfigKind = "embedding" | "prompt" | "rerank" | "search";
export type ProviderConfigStatus = "active" | "draft" | "validation_failed" | "validated";
export type PromptProviderRole =
	| "eval_judge_llm"
	| "eval_ragas_llm"
	| "hindsight_llm"
	| "primary_agent"
	| "rag_synthesis";
export type EmbeddingProviderRole =
	| "eval_ragas_embedding"
	| "hindsight_embedding"
	| "index_embedding"
	| "rag_query_embedding";
export type RerankProviderRole = "rag_reranker";
export type SearchProviderRole = "public_web_search";
export type ProviderConfigRole =
	| EmbeddingProviderRole
	| PromptProviderRole
	| RerankProviderRole
	| SearchProviderRole;
export type ProviderConfigFeature = "embedding" | "prompt" | "rerank" | "search";

export type ProviderConfigFeatureConfig = Record<string, unknown>;

export interface ProviderConfigSecretRef {
	ciphertext: string;
	fingerprint: string;
	last4: string;
}

export interface ProviderConfigProfile {
	active: boolean;
	apiKeySecret?: ProviderConfigSecretRef;
	baseUrl?: string;
	connectionId: string;
	createdAt: string;
	createdBy: ProviderConfigActor;
	dimensions: number | null;
	kind: ProviderConfigKind;
	model: string;
	profileId: string;
	provider?: string;
	revision: number;
	role: ProviderConfigRole;
	status: ProviderConfigStatus;
	timeoutMs: number;
	transport: string;
	updatedAt: string;
	updatedBy: ProviderConfigActor;
	validation: ProviderConfigValidationResult | null;
}

export interface ProviderConfigActor {
	displayName: string;
	principalId: string;
}

export interface ProviderConfigConnection {
	apiKeySecret: ProviderConfigSecretRef;
	baseUrl: string;
	features: ProviderConfigFeature[];
	featureConfig: ProviderConfigFeatureConfig;
	connectionId: string;
	createdAt: string;
	createdBy: ProviderConfigActor;
	provider: string;
	revision: number;
	updatedAt: string;
	updatedBy: ProviderConfigActor;
}

export interface ProviderConfigConnectionSummary {
	baseUrl: string;
	features: ProviderConfigFeature[];
	featureConfig: ProviderConfigFeatureConfig;
	connectionId: string;
	createdAt: string;
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
	secretConfigured: boolean;
	secretFingerprint: string;
	secretLast4: string;
	status: ProviderConfigStatus;
	timeoutMs: number;
	transport: string;
	updatedAt: string;
	validation: ProviderConfigValidationResult | null;
}

export interface ProviderConfigRuntimeSnapshot {
	api_key: string;
	base_url: string;
	feature_config?: ProviderConfigFeatureConfig;
	dimensions?: number;
	kind: ProviderConfigKind;
	model: string;
	profile_id: string;
	provider: string;
	revision: number;
	role: ProviderConfigRole;
	timeout_ms: number;
	transport: string;
}

export interface ProviderConfigValidationResult {
	errorCode?: string;
	message: string;
	observedDimensions?: number;
	ok: boolean;
	status: "failed" | "passed";
	validatedAt?: string;
}

export interface ProviderConfigCreatePayload {
	apiKey?: unknown;
	baseUrl?: unknown;
	connectionId?: unknown;
	dimensions?: unknown;
	kind?: unknown;
	model?: unknown;
	provider?: unknown;
	role?: unknown;
	timeoutMs?: unknown;
	transport?: unknown;
}

export interface ProviderConfigUpdatePayload {
	connectionId?: unknown;
	dimensions?: unknown;
	model?: unknown;
	timeoutMs?: unknown;
	transport?: unknown;
}

export interface ProviderConfigValidatorInput {
	apiKey: string;
	baseUrl: string;
	featureConfig: ProviderConfigFeatureConfig;
	dimensions: number | null;
	model: string;
	provider: string;
	role: ProviderConfigRole;
	timeoutMs: number;
	transport: string;
}

export interface ProviderConfigCompatibilityResult {
	ok: boolean;
	reason?: string;
}

export interface ProviderConfigValidators {
	checkEmbeddingCompatibility(
		input: ProviderConfigValidatorInput,
	): Promise<ProviderConfigCompatibilityResult>;
	validateEmbedding(input: ProviderConfigValidatorInput): Promise<ProviderConfigValidationResult>;
	validatePrompt(input: ProviderConfigValidatorInput): Promise<ProviderConfigValidationResult>;
	validateRerank(input: ProviderConfigValidatorInput): Promise<ProviderConfigValidationResult>;
	validateSearch(input: ProviderConfigValidatorInput): Promise<ProviderConfigValidationResult>;
}

export interface ProviderConfigConnectionCreatePayload {
	apiKey?: unknown;
	baseUrl?: unknown;
	features?: unknown;
	featureConfig?: unknown;
	provider?: unknown;
}

export interface ProviderConfigConnectionUpdatePayload {
	apiKey?: unknown;
	baseUrl?: unknown;
	features?: unknown;
	featureConfig?: unknown;
	provider?: unknown;
}

export interface ProviderConfigService {
	createConnection(input: {
		payload: ProviderConfigConnectionCreatePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ connection: ProviderConfigConnectionSummary }>;
	listConnections(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ connections: ProviderConfigConnectionSummary[] }>;
	updateConnection(input: {
		connectionId: string;
		payload: ProviderConfigConnectionUpdatePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ connection: ProviderConfigConnectionSummary }>;
	activateProfile(input: {
		principal: ResolvedAppPrincipal;
		profileId: string;
	}): Promise<{ profile: ProviderConfigProfileSummary }>;
	createProfile(input: {
		payload: ProviderConfigCreatePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ profile: ProviderConfigProfileSummary }>;
	getActiveRuntimeSnapshot(input: {
		role: string;
	}): Promise<{ profile: ProviderConfigRuntimeSnapshot }>;
	listProfiles(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ profiles: ProviderConfigProfileSummary[] }>;
	updateProfile(input: {
		payload: ProviderConfigUpdatePayload;
		principal: ResolvedAppPrincipal;
		profileId: string;
	}): Promise<{ profile: ProviderConfigProfileSummary }>;
	validateProfile(input: { principal: ResolvedAppPrincipal; profileId: string }): Promise<{
		profile: ProviderConfigProfileSummary;
		validation: ProviderConfigValidationResult;
	}>;
}
