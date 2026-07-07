import type {
	EmbeddingProviderRole,
	PromptProviderRole,
	ProviderConfigConnection,
	ProviderConfigKind,
	ProviderConfigProfile,
	ProviderConfigRole,
	RerankProviderRole,
	SearchProviderRole,
} from "./types";

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
const SEARCH_ROLES = new Set<SearchProviderRole>(["public_web_search"]);
const PUBLIC_WEB_SEARCH_PROVIDER_TRANSPORTS = new Map<string, Set<string>>([
	["gemini", new Set(["gemini_google_search"])],
	["linux_do", new Set(["openai_chat_completions_web_search"])],
	["openai", new Set(["openai_responses_web_search"])],
	["perplexity", new Set(["perplexity_search"])],
	["perplexity_compatible", new Set(["perplexity_search"])],
]);

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
	if (kind === "search" && SEARCH_ROLES.has(value as SearchProviderRole)) {
		return value as SearchProviderRole;
	}
	return null;
}

export function runtimeRole(value: string): ProviderConfigRole | null {
	if (
		PROMPT_ROLES.has(value as PromptProviderRole) ||
		EMBEDDING_ROLES.has(value as EmbeddingProviderRole) ||
		RERANK_ROLES.has(value as RerankProviderRole) ||
		SEARCH_ROLES.has(value as SearchProviderRole)
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
	if (input.role !== "public_web_search") {
		return null;
	}
	if (input.kind !== "search") {
		return {
			details: { field: "kind", kind: input.kind, role: input.role },
			message: "public_web_search requires search kind.",
		};
	}
	if (!publicWebSearchProviderTransportAdmitted(input.provider, input.transport)) {
		return {
			details: {
				field: "provider_transport",
				provider: input.provider,
				role: input.role,
				transport: input.transport,
			},
			message: "public_web_search provider/transport pair is not admitted.",
		};
	}
	return null;
}

function publicWebSearchProviderTransportAdmitted(provider: string, transport: string): boolean {
	return PUBLIC_WEB_SEARCH_PROVIDER_TRANSPORTS.get(provider)?.has(transport) ?? false;
}
