import type {
	EmbeddingProviderRole,
	PromptProviderRole,
	ProviderConfigConnection,
	ProviderConfigKind,
	ProviderConfigProfile,
	ProviderConfigRole,
	RerankProviderRole,
} from "./types";

const PROMPT_ROLES = new Set<PromptProviderRole>([
	"eval_judge_llm",
	"eval_ragas_llm",
	"hindsight_llm",
	"primary_agent",
]);
const EMBEDDING_ROLES = new Set<EmbeddingProviderRole>([
	"eval_ragas_embedding",
	"hindsight_embedding",
	"index_embedding",
	"rag_query_embedding",
]);
const RERANK_ROLES = new Set<RerankProviderRole>(["rag_reranker"]);

export function roleForKind(value: string, kind: ProviderConfigKind): ProviderConfigRole | null {
	if (kind === "prompt" && PROMPT_ROLES.has(value as PromptProviderRole)) {
		return value as PromptProviderRole;
	}
	if (kind === "embedding" && EMBEDDING_ROLES.has(value as EmbeddingProviderRole)) {
		return value as EmbeddingProviderRole;
	}
	if (kind === "rerank" && RERANK_ROLES.has(value as RerankProviderRole)) {
		return value as RerankProviderRole;
	}
	return null;
}

export function runtimeRole(value: string): ProviderConfigRole | null {
	if (
		PROMPT_ROLES.has(value as PromptProviderRole) ||
		EMBEDDING_ROLES.has(value as EmbeddingProviderRole) ||
		RERANK_ROLES.has(value as RerankProviderRole)
	) {
		return value as ProviderConfigRole;
	}
	return null;
}

export function profilePolicyViolation(
	profile: ProviderConfigProfile,
	connection: ProviderConfigConnection,
): { details: Record<string, unknown>; message: string } | null {
	return providerProfilePolicyViolation({
		connectionId: connection.connectionId,
		features: connection.features,
		kind: profile.kind,
		provider: connection.provider,
		role: profile.role,
		transport: profile.transport,
	});
}

export function providerProfilePolicyViolation(input: {
	connectionId: string;
	features: ProviderConfigKind[];
	kind: ProviderConfigKind;
	provider: string;
	role: ProviderConfigRole;
	transport: string;
}): { details: Record<string, unknown>; message: string } | null {
	if (!input.features.includes(input.kind)) {
		return {
			details: { connectionId: input.connectionId, kind: input.kind },
			message: "connection does not support provider profile kind.",
		};
	}
	return null;
}
