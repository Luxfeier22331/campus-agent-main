export type ProviderConfigKind = "embedding" | "prompt";
export type ProviderConfigStatus = "active" | "draft" | "validation_failed" | "validated";
export type ProviderConfigRole =
	| "eval_judge_llm"
	| "eval_ragas_embedding"
	| "eval_ragas_llm"
	| "index_embedding"
	| "primary_agent"
	| "rag_query_embedding"
	| "rag_synthesis";

export interface ProviderConfigProfile {
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
	secretFingerprint?: string;
	secretLast4: string;
	status: ProviderConfigStatus;
	timeoutMs: number;
	transport: string;
	updatedAt: string;
	validation: ProviderConfigValidationResult | null;
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
	apiKey: string;
	baseUrl: string;
	dimensions?: number;
	kind: ProviderConfigKind;
	model: string;
	provider: "openai";
	role: ProviderConfigRole;
	timeoutMs: number;
	transport: "embeddings" | "responses";
}

export interface ProviderConfigUpdatePayload {
	apiKey?: string;
	baseUrl?: string;
	dimensions?: number;
	model?: string;
	timeoutMs?: number;
	transport?: "embeddings" | "responses";
}
