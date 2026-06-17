import type { ResolvedAppPrincipal } from "../auth";

export type ProviderConfigKind = "embedding" | "prompt";
export type ProviderConfigStatus = "active" | "draft" | "validation_failed" | "validated";
export type PromptProviderRole = "memory_graph_llm" | "primary_agent" | "rag_synthesis";
export type EmbeddingProviderRole = "index_embedding" | "rag_query_embedding";
export type ProviderConfigRole = EmbeddingProviderRole | PromptProviderRole;

export interface ProviderConfigSecretRef {
	ciphertext: string;
	fingerprint: string;
	last4: string;
}

export interface ProviderConfigProfile {
	active: boolean;
	apiKeySecret: ProviderConfigSecretRef;
	baseUrl: string;
	createdAt: string;
	createdBy: ProviderConfigActor;
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
	updatedBy: ProviderConfigActor;
	validation: ProviderConfigValidationResult | null;
}

export interface ProviderConfigActor {
	displayName: string;
	principalId: string;
}

export interface ProviderConfigProfileSummary {
	active: boolean;
	baseUrl: string;
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
	dimensions?: number;
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
	dimensions?: unknown;
	kind?: unknown;
	model?: unknown;
	provider?: unknown;
	role?: unknown;
	timeoutMs?: unknown;
	transport?: unknown;
}

export interface ProviderConfigUpdatePayload {
	apiKey?: unknown;
	baseUrl?: unknown;
	dimensions?: unknown;
	model?: unknown;
	timeoutMs?: unknown;
	transport?: unknown;
}

export interface ProviderConfigValidatorInput {
	apiKey: string;
	baseUrl: string;
	dimensions: number | null;
	model: string;
	provider: string;
	role: ProviderConfigRole;
	timeoutMs: number;
	transport: string;
}

export interface ProviderConfigEmbeddingCompatibilityInput {
	profile: ProviderConfigProfile;
	rawApiKey: string;
}

export interface ProviderConfigCompatibilityResult {
	ok: boolean;
	reason?: string;
}

export interface ProviderConfigValidators {
	checkEmbeddingCompatibility(
		input: ProviderConfigEmbeddingCompatibilityInput,
	): Promise<ProviderConfigCompatibilityResult>;
	validateEmbedding(input: ProviderConfigValidatorInput): Promise<ProviderConfigValidationResult>;
	validatePrompt(input: ProviderConfigValidatorInput): Promise<ProviderConfigValidationResult>;
}

export interface ProviderConfigService {
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
