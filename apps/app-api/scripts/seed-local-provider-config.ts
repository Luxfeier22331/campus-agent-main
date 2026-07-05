import process from "node:process";

type PromptRole =
	| "eval_judge_llm"
	| "eval_ragas_llm"
	| "hindsight_llm"
	| "primary_agent"
	| "rag_synthesis";
type EmbeddingRole = "eval_ragas_embedding" | "hindsight_embedding" | "rag_query_embedding";
type RerankRole = "rag_reranker";
type SearchRole = "public_web_search";
type SeedStage = "all" | "embedding" | "prompt" | "rerank" | "search";

interface Args {
	apiKey: string;
	appApiBaseUrl: string;
	authHeader: string;
	baseUrl: string;
	cookie: string;
	internalSharedSecret: string;
	embedding: {
		apiKey: string;
		baseUrl: string;
		dimensions: number;
		model: string;
		provider: string;
		timeoutMs: number;
		transport: string;
	} | null;
	models: Record<PromptRole, string>;
	operatorEmail: string;
	provider: string;
	rerank: {
		apiKey: string;
		baseUrl: string;
		model: string;
		path: string;
		provider: string;
		timeoutMs: number;
		transport: string;
	} | null;
	search: {
		apiKey: string;
		baseUrl: string;
		model: string;
		provider: string;
		timeoutMs: number;
		transport: string;
	} | null;
	stage: SeedStage;
	timeoutMs: number;
	transports: Record<PromptRole, string>;
}

const PROMPT_ROLES: PromptRole[] = [
	"primary_agent",
	"rag_synthesis",
	"hindsight_llm",
	"eval_ragas_llm",
	"eval_judge_llm",
];
const EMBEDDING_ROLES: EmbeddingRole[] = [
	"rag_query_embedding",
	"hindsight_embedding",
	"eval_ragas_embedding",
];

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

async function main() {
	const args = parseArgs(process.argv.slice(2), process.env);
	if (shouldRunStage(args.stage, "prompt")) {
		const promptConnection = await createConnection(args, {
			apiKey: args.apiKey,
			baseUrl: args.baseUrl,
			features: ["prompt"],
			featureConfig: {},
			provider: args.provider,
		});
		for (const role of PROMPT_ROLES) {
			const created = await requestJson<{ profile: { profileId: string } }>(args, {
				body: {
					connectionId: promptConnection.connection.connectionId,
					kind: "prompt",
					model: args.models[role],
					role,
					timeoutMs: args.timeoutMs,
					transport: args.transports[role],
				},
				method: "POST",
				path: "/api/operator/provider-config/profiles",
			});
			const profileId = created.profile.profileId;
			await requestJson(args, {
				method: "POST",
				path: `/api/operator/provider-config/profiles/${encodeURIComponent(profileId)}/validate`,
			});
			await requestJson(args, {
				method: "POST",
				path: `/api/operator/provider-config/profiles/${encodeURIComponent(profileId)}/activate`,
			});
			console.log(`${role}: activated ${profileId} (${args.models[role]})`);
		}
	}
	if (args.embedding && shouldRunStage(args.stage, "embedding")) {
		const embeddingConnection = await createConnection(args, {
			apiKey: args.embedding.apiKey,
			baseUrl: args.embedding.baseUrl,
			features: ["embedding"],
			featureConfig: {},
			provider: args.embedding.provider,
		});
		for (const role of EMBEDDING_ROLES) {
			await createAndActivateProfile(args, {
				connection: embeddingConnection,
				dimensions: args.embedding.dimensions,
				kind: "embedding",
				model: args.embedding.model,
				role,
				timeoutMs: args.embedding.timeoutMs,
				transport: args.embedding.transport,
			});
		}
	}
	if (args.rerank && shouldRunStage(args.stage, "rerank")) {
		await createAndActivateProfile(args, {
			connection: await createConnection(args, {
				apiKey: args.rerank.apiKey,
				baseUrl: args.rerank.baseUrl,
				features: ["rerank"],
				featureConfig: { rerank: { path: args.rerank.path } },
				provider: args.rerank.provider,
			}),
			kind: "rerank",
			model: args.rerank.model,
			role: "rag_reranker",
			timeoutMs: args.rerank.timeoutMs,
			transport: args.rerank.transport,
		});
	}
	if (args.search && shouldRunStage(args.stage, "search")) {
		await createAndActivateProfile(args, {
			connection: await createConnection(args, {
				apiKey: args.search.apiKey,
				baseUrl: args.search.baseUrl,
				features: ["search"],
				featureConfig: {},
				provider: args.search.provider,
			}),
			kind: "search",
			model: args.search.model,
			role: "public_web_search",
			timeoutMs: args.search.timeoutMs,
			transport: args.search.transport,
		});
	}
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) {
			throw new Error(`unexpected argument ${token}`);
		}
		const key = token.slice(2);
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${token} requires a non-empty value`);
		}
		values.set(key, value);
		index += 1;
	}

	const stage = parseStage(readCli(values, "stage") || "all");
	const sharedModel = readCli(values, "model") || readEnv(env, "LLM_MODEL");
	const primaryAgentModel = readCli(values, "primary-agent-model") || sharedModel;
	const ragSynthesisModel =
		readCli(values, "rag-synthesis-model") || readEnv(env, "RAG_SYNTHESIS_MODEL") || sharedModel;
	if (shouldRunStage(stage, "prompt") && !(primaryAgentModel && ragSynthesisModel)) {
		throw new Error("--model/LLM_MODEL and --rag-synthesis-model/RAG_SYNTHESIS_MODEL are required");
	}
	const defaultPromptTransport = readCli(values, "transport") || "responses";

	const apiKey = readCli(values, "api-key") || readEnv(env, "LLM_API_KEY");
	if (shouldRunStage(stage, "prompt") && !apiKey) {
		throw new Error("--api-key or LLM_API_KEY is required");
	}

	const authHeader =
		readCli(values, "auth-header") ||
		readEnv(env, "APP_API_OPERATOR_AUTH_HEADER") ||
		bearerHeader(readEnv(env, "APP_API_OPERATOR_BEARER_TOKEN"));
	const cookie = readCli(values, "cookie") || readEnv(env, "APP_API_OPERATOR_COOKIE");
	const internalSharedSecret =
		readCli(values, "internal-shared-secret") || readEnv(env, "APP_API_INTERNAL_SHARED_SECRET");
	const operatorEmail =
		readCli(values, "operator-email") ||
		readEnv(env, "APP_API_OPERATOR_EMAIL") ||
		firstCsvValue(readEnv(env, "APP_API_OPERATOR_EMAIL_ALLOWLIST"));
	if (!(authHeader || cookie || (internalSharedSecret && operatorEmail))) {
		throw new Error(
			"--auth-header, --cookie, or APP_API_INTERNAL_SHARED_SECRET plus APP_API_OPERATOR_EMAIL_ALLOWLIST is required",
		);
	}

	return {
		apiKey,
		appApiBaseUrl:
			readCli(values, "app-api-base-url") ||
			readEnv(env, "APP_API_BASE_URL") ||
			"http://127.0.0.1:27031",
		authHeader,
		baseUrl:
			readCli(values, "base-url") || readEnv(env, "LLM_BASE_URL") || "https://api.openai.com/v1",
		cookie,
		internalSharedSecret,
		embedding: parseEmbeddingArgs(values, env, stage),
		models: {
			eval_judge_llm: primaryAgentModel,
			eval_ragas_llm: primaryAgentModel,
			hindsight_llm: primaryAgentModel,
			primary_agent: primaryAgentModel,
			rag_synthesis: ragSynthesisModel,
		},
		operatorEmail,
		provider: readCli(values, "provider") || "openai",
		rerank: parseRerankArgs(values, env, stage),
		search: parseSearchArgs(values, env, stage),
		stage,
		timeoutMs: parsePositiveInteger(readCli(values, "timeout-ms") || "30000", "--timeout-ms"),
		transports: {
			eval_judge_llm: defaultPromptTransport,
			eval_ragas_llm: defaultPromptTransport,
			hindsight_llm: defaultPromptTransport,
			primary_agent: defaultPromptTransport,
			rag_synthesis: defaultPromptTransport,
		},
	};
}

function parseEmbeddingArgs(
	values: Map<string, string>,
	env: NodeJS.ProcessEnv,
	stage: SeedStage,
): Args["embedding"] {
	const model = readCli(values, "embedding-model") || readEnv(env, "EMBEDDING_MODEL");
	const apiKey = readCli(values, "embedding-api-key") || readEnv(env, "EMBEDDING_API_KEY");
	if (!(apiKey || shouldRunStage(stage, "embedding"))) {
		return null;
	}
	if (!apiKey) {
		throw new Error("--embedding-api-key or EMBEDDING_API_KEY is required");
	}
	return {
		apiKey,
		baseUrl:
			readCli(values, "embedding-base-url") ||
			readEnv(env, "EMBEDDING_BASE_URL") ||
			"https://ai.gitee.com/v1",
		dimensions: parsePositiveInteger(
			readCli(values, "embedding-dimensions") || readEnv(env, "EMBEDDING_DIMENSIONS") || "2560",
			"--embedding-dimensions",
		),
		model: model || "Qwen3-Embedding-4B",
		provider:
			readCli(values, "embedding-provider") ||
			readEnv(env, "EMBEDDING_PROVIDER") ||
			"openai-compatible",
		timeoutMs: parsePositiveInteger(
			readCli(values, "embedding-timeout-ms") || "30000",
			"--embedding-timeout-ms",
		),
		transport: readCli(values, "embedding-transport") || "embeddings",
	};
}

function parseRerankArgs(
	values: Map<string, string>,
	env: NodeJS.ProcessEnv,
	stage: SeedStage,
): Args["rerank"] {
	const model = readCli(values, "rerank-model") || readEnv(env, "RERANK_MODEL");
	const apiKey = readCli(values, "rerank-api-key") || readEnv(env, "RERANK_API_KEY");
	const configuredPath = readCli(values, "rerank-path") || readEnv(env, "RERANK_PATH");
	if (!shouldRunStage(stage, "rerank")) {
		return null;
	}
	if (!(model || apiKey)) {
		return null;
	}
	if (!(model && apiKey)) {
		throw new Error(
			"--rerank-model/RERANK_MODEL and --rerank-api-key/RERANK_API_KEY are required when seeding rerank",
		);
	}
	return {
		apiKey,
		baseUrl:
			readCli(values, "rerank-base-url") ||
			readEnv(env, "RERANK_BASE_URL") ||
			"https://ai.gitee.com/v1",
		model,
		path: configuredPath || "/rerank",
		provider: readCli(values, "rerank-provider") || readEnv(env, "RERANK_PROVIDER") || "gitee",
		timeoutMs: parsePositiveInteger(
			readCli(values, "rerank-timeout-ms") || "30000",
			"--rerank-timeout-ms",
		),
		transport: readCli(values, "rerank-transport") || "gitee_rerank",
	};
}

function parseSearchArgs(
	values: Map<string, string>,
	env: NodeJS.ProcessEnv,
	stage: SeedStage,
): Args["search"] {
	const model =
		readCli(values, "public-web-search-model") || readEnv(env, "PUBLIC_WEB_SEARCH_MODEL");
	const apiKey =
		readCli(values, "public-web-search-api-key") || readEnv(env, "PUBLIC_WEB_SEARCH_API_KEY");
	const provider =
		readCli(values, "public-web-search-provider") ||
		readEnv(env, "PUBLIC_WEB_SEARCH_PROVIDER") ||
		"perplexity";
	if (!shouldRunStage(stage, "search")) {
		return null;
	}
	if (!(model && apiKey)) {
		throw new Error(
			"--public-web-search-model/PUBLIC_WEB_SEARCH_MODEL and --public-web-search-api-key/PUBLIC_WEB_SEARCH_API_KEY are required when seeding search",
		);
	}
	return {
		apiKey,
		baseUrl:
			readCli(values, "public-web-search-base-url") ||
			readEnv(env, "PUBLIC_WEB_SEARCH_BASE_URL") ||
			defaultPublicWebSearchBaseURL(provider),
		model,
		provider,
		timeoutMs: parsePositiveInteger(
			readCli(values, "public-web-search-timeout-ms") || "30000",
			"--public-web-search-timeout-ms",
		),
		transport:
			readCli(values, "public-web-search-transport") ||
			readEnv(env, "PUBLIC_WEB_SEARCH_TRANSPORT") ||
			defaultPublicWebSearchTransport(provider),
	};
}

function defaultPublicWebSearchBaseURL(provider: string): string {
	if (provider === "gemini") {
		return "https://generativelanguage.googleapis.com/v1beta";
	}
	if (provider === "linux_do") {
		return "https://hub.linux.do/v1";
	}
	if (provider === "openai") {
		return "https://api.openai.com/v1";
	}
	return "https://api.perplexity.ai";
}

function defaultPublicWebSearchTransport(provider: string): string {
	if (provider === "gemini") {
		return "gemini_google_search";
	}
	if (provider === "openai") {
		return "openai_responses_web_search";
	}
	if (provider === "linux_do") {
		return "openai_chat_completions_web_search";
	}
	return "perplexity_search";
}

async function createConnection(
	args: Args,
	body: {
		apiKey: string;
		baseUrl: string;
		features: string[];
		featureConfig: Record<string, unknown>;
		provider: string;
	},
): Promise<{ connection: { connectionId: string } }> {
	return requestJson(args, {
		body,
		method: "POST",
		path: "/api/operator/provider-config/connections",
	});
}

async function createAndActivateProfile(
	args: Args,
	input: {
		connection: { connection: { connectionId: string } };
		dimensions?: number;
		kind: "embedding" | "rerank" | "search";
		model: string;
		role: EmbeddingRole | RerankRole | SearchRole;
		timeoutMs: number;
		transport: string;
	},
) {
	const created = await requestJson<{ profile: { profileId: string } }>(args, {
		body: {
			connectionId: input.connection.connection.connectionId,
			dimensions: input.dimensions,
			kind: input.kind,
			model: input.model,
			role: input.role,
			timeoutMs: input.timeoutMs,
			transport: input.transport,
		},
		method: "POST",
		path: "/api/operator/provider-config/profiles",
	});
	const profileId = created.profile.profileId;
	await requestJson(args, {
		method: "POST",
		path: `/api/operator/provider-config/profiles/${encodeURIComponent(profileId)}/validate`,
	});
	await requestJson(args, {
		method: "POST",
		path: `/api/operator/provider-config/profiles/${encodeURIComponent(profileId)}/activate`,
	});
	console.log(`${input.role}: activated ${profileId} (${input.model})`);
}

async function requestJson<T>(
	args: Args,
	input: { body?: unknown; method: string; path: string },
): Promise<T> {
	const headers: Record<string, string> = {};
	if (input.body !== undefined) {
		headers["content-type"] = "application/json";
	}
	if (args.authHeader) {
		headers.authorization = args.authHeader;
	}
	if (args.cookie) {
		headers.cookie = args.cookie;
	}
	if (args.internalSharedSecret && args.operatorEmail) {
		headers["x-app-internal-auth"] = args.internalSharedSecret;
		headers["x-app-operator-email"] = args.operatorEmail;
	}
	const response = await fetch(`${args.appApiBaseUrl.replace(/\/+$/, "")}${input.path}`, {
		body: input.body === undefined ? undefined : JSON.stringify(input.body),
		headers,
		method: input.method,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${input.method} ${input.path} failed with HTTP ${response.status}: ${text}`);
	}
	return (text ? JSON.parse(text) : {}) as T;
}

function readCli(values: Map<string, string>, key: string): string {
	return values.get(key)?.trim() || "";
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
	return env[key]?.trim() || "";
}

function bearerHeader(token: string): string {
	return token ? `Bearer ${token}` : "";
}

function firstCsvValue(value: string): string {
	return (
		value
			.split(",")
			.map((item) => item.trim())
			.find(Boolean) ?? ""
	);
}

function parseStage(value: string): SeedStage {
	if (
		value === "all" ||
		value === "prompt" ||
		value === "embedding" ||
		value === "rerank" ||
		value === "search"
	) {
		return value;
	}
	throw new Error("--stage must be one of all, prompt, embedding, rerank, search");
}

function shouldRunStage(configured: SeedStage, candidate: Exclude<SeedStage, "all">): boolean {
	return configured === "all" || configured === candidate;
}

function parsePositiveInteger(raw: string, label: string): number {
	const value = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}
