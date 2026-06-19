import process from "node:process";

type PromptRole = "primary_agent" | "rag_synthesis";
type EmbeddingRole = "rag_query_embedding";
type RerankRole = "rag_reranker";

interface Args {
	apiKey: string;
	appApiBaseUrl: string;
	authHeader: string;
	baseUrl: string;
	cookie: string;
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
	timeoutMs: number;
	transport: string;
}

const PROMPT_ROLES: PromptRole[] = ["primary_agent", "rag_synthesis"];

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

async function main() {
	const args = parseArgs(process.argv.slice(2), process.env);
	const promptConnection = await createConnection(args, {
		apiKey: args.apiKey,
		baseUrl: args.baseUrl,
		capabilities: ["prompt"],
		capabilityConfig: {},
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
				transport: args.transport,
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
	if (args.embedding) {
		await createAndActivateProfile(args, {
			connection: await createConnection(args, {
				apiKey: args.embedding.apiKey,
				baseUrl: args.embedding.baseUrl,
				capabilities: ["embedding"],
				capabilityConfig: {},
				provider: args.embedding.provider,
			}),
			dimensions: args.embedding.dimensions,
			kind: "embedding",
			model: args.embedding.model,
			role: "rag_query_embedding",
			timeoutMs: args.embedding.timeoutMs,
			transport: args.embedding.transport,
		});
	}
	if (args.rerank) {
		await createAndActivateProfile(args, {
			connection: await createConnection(args, {
				apiKey: args.rerank.apiKey,
				baseUrl: args.rerank.baseUrl,
				capabilities: ["rerank"],
				capabilityConfig: { rerank: { path: args.rerank.path } },
				provider: args.rerank.provider,
			}),
			kind: "rerank",
			model: args.rerank.model,
			role: "rag_reranker",
			timeoutMs: args.rerank.timeoutMs,
			transport: args.rerank.transport,
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

	const sharedModel = readCli(values, "model") || readEnv(env, "LLM_MODEL");
	const primaryAgentModel = readCli(values, "primary-agent-model") || sharedModel;
	const ragSynthesisModel =
		readCli(values, "rag-synthesis-model") || readEnv(env, "RAG_SYNTHESIS_MODEL") || sharedModel;
	if (!(primaryAgentModel && ragSynthesisModel)) {
		throw new Error(
			"--model, LLM_MODEL, or both --primary-agent-model and --rag-synthesis-model are required",
		);
	}

	const apiKey = readCli(values, "api-key") || readEnv(env, "LLM_API_KEY");
	if (!apiKey) {
		throw new Error("--api-key or LLM_API_KEY is required");
	}

	const authHeader =
		readCli(values, "auth-header") ||
		readEnv(env, "APP_API_OPERATOR_AUTH_HEADER") ||
		bearerHeader(readEnv(env, "APP_API_OPERATOR_BEARER_TOKEN"));
	const cookie = readCli(values, "cookie") || readEnv(env, "APP_API_OPERATOR_COOKIE");
	if (!(authHeader || cookie)) {
		throw new Error(
			"--auth-header, --cookie, APP_API_OPERATOR_AUTH_HEADER, APP_API_OPERATOR_BEARER_TOKEN, or APP_API_OPERATOR_COOKIE is required",
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
		embedding: parseEmbeddingArgs(values, env),
		models: {
			primary_agent: primaryAgentModel,
			rag_synthesis: ragSynthesisModel,
		},
		provider: readCli(values, "provider") || "openai",
		rerank: parseRerankArgs(values, env),
		timeoutMs: parsePositiveInteger(readCli(values, "timeout-ms") || "30000", "--timeout-ms"),
		transport: readCli(values, "transport") || "responses",
	};
}

function parseEmbeddingArgs(
	values: Map<string, string>,
	env: NodeJS.ProcessEnv,
): Args["embedding"] {
	const model = readCli(values, "embedding-model") || readEnv(env, "EMBEDDING_MODEL");
	const apiKey = readCli(values, "embedding-api-key") || readEnv(env, "EMBEDDING_API_KEY");
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
			readCli(values, "embedding-provider") || readEnv(env, "EMBEDDING_PROVIDER") || "gitee",
		timeoutMs: parsePositiveInteger(
			readCli(values, "embedding-timeout-ms") || "30000",
			"--embedding-timeout-ms",
		),
		transport: readCli(values, "embedding-transport") || "embeddings",
	};
}

function parseRerankArgs(values: Map<string, string>, env: NodeJS.ProcessEnv): Args["rerank"] {
	const model = readCli(values, "rerank-model") || readEnv(env, "RERANK_MODEL");
	const apiKey = readCli(values, "rerank-api-key") || readEnv(env, "RERANK_API_KEY");
	const configuredPath = readCli(values, "rerank-path") || readEnv(env, "RERANK_PATH");
	if (!(model || apiKey || configuredPath)) {
		return null;
	}
	if (!(model && apiKey)) {
		throw new Error("--rerank-model/RERANK_MODEL and --rerank-api-key/RERANK_API_KEY are required when seeding rerank");
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

async function createConnection(
	args: Args,
	body: {
		apiKey: string;
		baseUrl: string;
		capabilities: string[];
		capabilityConfig: Record<string, unknown>;
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
		kind: "embedding" | "rerank";
		model: string;
		role: EmbeddingRole | RerankRole;
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

function parsePositiveInteger(raw: string, label: string): number {
	const value = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}
