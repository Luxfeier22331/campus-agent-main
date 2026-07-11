export type ProviderConfigKind = "embedding" | "prompt" | "rerank";
export type ProviderConfigTransport = "chat_completions" | "embeddings" | "responses";
export type ProviderConfigStatus = "active" | "draft" | "validation_failed" | "validated";
export type ProviderConfigFeature = "embedding" | "prompt" | "rerank";
export type ProviderConfigRole =
	| "eval_judge_llm"
	| "eval_ragas_embedding"
	| "eval_ragas_llm"
	| "hindsight_embedding"
	| "hindsight_llm"
	| "index_embedding"
	| "primary_agent"
	| "rag_query_embedding"
	| "rag_reranker";

export interface ProviderConfigConnection {
	baseUrl: string;
	connectionId: string;
	createdAt: string;
	features: ProviderConfigFeature[];
	featureConfig: Record<string, unknown>;
	provider: string;
	revision: number;
	secretConfigured: boolean;
	secretFingerprint?: string;
	secretLast4: string;
	updatedAt: string;
}

export interface ProviderConfigProfile {
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

export interface ProviderConfigConnectionCreatePayload {
	apiKey: string;
	baseUrl: string;
	featureConfig?: Record<string, unknown>;
	features: ProviderConfigFeature[];
	provider: "openai" | "openai-compatible";
}

export interface ProviderConfigConnectionUpdatePayload {
	apiKey?: string;
	baseUrl?: string;
	featureConfig?: Record<string, unknown>;
	features?: ProviderConfigFeature[];
	provider?: "openai" | "openai-compatible";
}

export interface ProviderConfigProfileCreatePayload {
	connectionId: string;
	dimensions?: number;
	kind: ProviderConfigKind;
	model: string;
	role: ProviderConfigRole;
	timeoutMs: number;
	transport: ProviderConfigTransport;
}

export interface ProviderConfigProfileUpdatePayload {
	connectionId?: string;
	dimensions?: number;
	model?: string;
	timeoutMs?: number;
	transport?: ProviderConfigTransport;
}
