// @vitest-environment node

import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = resolve(__dirname, "..");

describe("local provider-config seed script", () => {
	it("seeds prompt, Hindsight, embedding, and rerank profiles from local provider env", async () => {
		const server = new RecordingProviderConfigServer();
		await server.listen();
		try {
			const result = await runSeedScript({
				args: ["--app-api-base-url", server.baseUrl],
				env: {
					APP_API_OPERATOR_BEARER_TOKEN: "operator-token",
					EMBEDDING_API_KEY: "embedding-key",
					LLM_API_KEY: "llm-key",
					LLM_MODEL: "gpt-shared",
					PUBLIC_WEB_SEARCH_API_KEY: "pplx-key",
					PUBLIC_WEB_SEARCH_MODEL: "sonar",
					RAG_SYNTHESIS_MODEL: "gpt-rag",
					RERANK_API_KEY: "rerank-key",
					RERANK_MODEL: "gte-reranker",
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(server.connectionBodies()).toEqual([
				{
					apiKey: "llm-key",
					baseUrl: "https://api.openai.com/v1",
					features: ["prompt"],
					featureConfig: {},
					provider: "openai",
				},
				{
					apiKey: "embedding-key",
					baseUrl: "https://ai.gitee.com/v1",
					features: ["embedding"],
					featureConfig: {},
					provider: "openai-compatible",
				},
				{
					apiKey: "rerank-key",
					baseUrl: "https://ai.gitee.com/v1",
					features: ["rerank"],
					featureConfig: { rerank: { path: "/rerank" } },
					provider: "gitee",
				},
				{
					apiKey: "pplx-key",
					baseUrl: "https://api.perplexity.ai",
					features: ["search"],
					featureConfig: {},
					provider: "perplexity",
				},
			]);
			expect(server.profileBodies()).toEqual([
				expect.objectContaining({
					kind: "prompt",
					model: "gpt-shared",
					role: "primary_agent",
					transport: "responses",
				}),
				expect.objectContaining({
					kind: "prompt",
					model: "gpt-rag",
					role: "rag_synthesis",
					transport: "responses",
				}),
				expect.objectContaining({
					kind: "prompt",
					model: "gpt-shared",
					role: "hindsight_llm",
					transport: "responses",
				}),
				expect.objectContaining({
					kind: "prompt",
					model: "gpt-shared",
					role: "eval_ragas_llm",
					transport: "responses",
				}),
				expect.objectContaining({
					kind: "prompt",
					model: "gpt-shared",
					role: "eval_judge_llm",
					transport: "responses",
				}),
				expect.objectContaining({
					dimensions: 2560,
					kind: "embedding",
					model: "Qwen3-Embedding-4B",
					role: "rag_query_embedding",
					transport: "embeddings",
				}),
				expect.objectContaining({
					dimensions: 2560,
					kind: "embedding",
					model: "Qwen3-Embedding-4B",
					role: "hindsight_embedding",
					transport: "embeddings",
				}),
				expect.objectContaining({
					dimensions: 2560,
					kind: "embedding",
					model: "Qwen3-Embedding-4B",
					role: "eval_ragas_embedding",
					transport: "embeddings",
				}),
				expect.objectContaining({
					kind: "rerank",
					model: "gte-reranker",
					role: "rag_reranker",
					transport: "gitee_rerank",
				}),
				expect.objectContaining({
					kind: "search",
					model: "sonar",
					role: "public_web_search",
					transport: "perplexity_search",
				}),
			]);
			expect(server.validationPaths()).toHaveLength(10);
			expect(server.activationPaths()).toHaveLength(10);
		} finally {
			await server.close();
		}
	}, 20_000);

	it("fails fast when the required embedding key is missing", async () => {
		const server = new RecordingProviderConfigServer();
		await server.listen();
		try {
			const result = await runSeedScript({
				args: ["--app-api-base-url", server.baseUrl],
				env: {
					APP_API_OPERATOR_BEARER_TOKEN: "operator-token",
					LLM_API_KEY: "llm-key",
					LLM_MODEL: "gpt-shared",
					PUBLIC_WEB_SEARCH_API_KEY: "pplx-key",
					PUBLIC_WEB_SEARCH_MODEL: "sonar",
				},
			});

			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("EMBEDDING_API_KEY is required");
			expect(server.requests).toEqual([]);
		} finally {
			await server.close();
		}
	}, 20_000);

	it("seeds public web search with an explicit compatible provider identity", async () => {
		const server = new RecordingProviderConfigServer();
		await server.listen();
		try {
			const result = await runSeedScript({
				args: ["--app-api-base-url", server.baseUrl, "--stage", "search"],
				env: {
					APP_API_OPERATOR_BEARER_TOKEN: "operator-token",
					PUBLIC_WEB_SEARCH_API_KEY: "compatible-key",
					PUBLIC_WEB_SEARCH_BASE_URL: "https://compatible-search.example",
					PUBLIC_WEB_SEARCH_MODEL: "sonar-compatible",
					PUBLIC_WEB_SEARCH_PROVIDER: "perplexity_compatible",
					PUBLIC_WEB_SEARCH_TRANSPORT: "perplexity_search",
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(server.connectionBodies()).toEqual([
				{
					apiKey: "compatible-key",
					baseUrl: "https://compatible-search.example",
					features: ["search"],
					featureConfig: {},
					provider: "perplexity_compatible",
				},
			]);
			expect(server.profileBodies()).toEqual([
				expect.objectContaining({
					kind: "search",
					model: "sonar-compatible",
					role: "public_web_search",
					transport: "perplexity_search",
				}),
			]);
			expect(server.validationPaths()).toHaveLength(1);
			expect(server.activationPaths()).toHaveLength(1);
		} finally {
			await server.close();
		}
	}, 20_000);

	it("seeds public web search with Gemini defaults when provider is Gemini", async () => {
		const server = new RecordingProviderConfigServer();
		await server.listen();
		try {
			const result = await runSeedScript({
				args: ["--app-api-base-url", server.baseUrl, "--stage", "search"],
				env: {
					APP_API_OPERATOR_BEARER_TOKEN: "operator-token",
					PUBLIC_WEB_SEARCH_API_KEY: "gemini-key",
					PUBLIC_WEB_SEARCH_MODEL: "gemini-2.5-flash",
					PUBLIC_WEB_SEARCH_PROVIDER: "gemini",
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(server.connectionBodies()).toEqual([
				{
					apiKey: "gemini-key",
					baseUrl: "https://generativelanguage.googleapis.com/v1beta",
					features: ["search"],
					featureConfig: {},
					provider: "gemini",
				},
			]);
			expect(server.profileBodies()).toEqual([
				expect.objectContaining({
					kind: "search",
					model: "gemini-2.5-flash",
					role: "public_web_search",
					transport: "gemini_google_search",
				}),
			]);
		} finally {
			await server.close();
		}
	}, 20_000);

	it("seeds public web search with Linux.do Chat Completions web search defaults", async () => {
		const server = new RecordingProviderConfigServer();
		await server.listen();
		try {
			const result = await runSeedScript({
				args: ["--app-api-base-url", server.baseUrl, "--stage", "search"],
				env: {
					APP_API_OPERATOR_BEARER_TOKEN: "operator-token",
					PUBLIC_WEB_SEARCH_API_KEY: "linux-do-key",
					PUBLIC_WEB_SEARCH_MODEL: "gpt-5-search-api-2025-10-14",
					PUBLIC_WEB_SEARCH_PROVIDER: "linux_do",
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(server.connectionBodies()).toEqual([
				{
					apiKey: "linux-do-key",
					baseUrl: "https://hub.linux.do/v1",
					features: ["search"],
					featureConfig: {},
					provider: "linux_do",
				},
			]);
			expect(server.profileBodies()).toEqual([
				expect.objectContaining({
					kind: "search",
					model: "gpt-5-search-api-2025-10-14",
					role: "public_web_search",
					transport: "openai_chat_completions_web_search",
				}),
			]);
		} finally {
			await server.close();
		}
	}, 20_000);
});

async function runSeedScript(input: {
	args: string[];
	env: Record<string, string>;
}): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
	const env = { ...process.env };
	for (const key of [
		"APP_API_OPERATOR_AUTH_HEADER",
		"APP_API_OPERATOR_BEARER_TOKEN",
		"APP_API_OPERATOR_COOKIE",
		"EMBEDDING_API_KEY",
		"EMBEDDING_BASE_URL",
		"EMBEDDING_DIMENSIONS",
		"EMBEDDING_MODEL",
		"LLM_API_KEY",
		"LLM_BASE_URL",
		"LLM_MODEL",
		"PUBLIC_WEB_SEARCH_API_KEY",
		"PUBLIC_WEB_SEARCH_BASE_URL",
		"PUBLIC_WEB_SEARCH_MODEL",
		"PUBLIC_WEB_SEARCH_PROVIDER",
		"PUBLIC_WEB_SEARCH_TRANSPORT",
		"RAG_SYNTHESIS_MODEL",
		"RERANK_API_KEY",
		"RERANK_BASE_URL",
		"RERANK_MODEL",
		"RERANK_PATH",
	]) {
		delete env[key];
	}
	Object.assign(env, input.env);

	return new Promise((resolvePromise, reject) => {
		const child = spawn(
			"pnpm",
			["exec", "tsx", "./ops/dev/seed-local-provider-config.ts", ...input.args],
			{
				cwd: appDir,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", reject);
		child.on("exit", (exitCode) => {
			resolvePromise({ exitCode, stderr, stdout });
		});
	});
}

class RecordingProviderConfigServer {
	readonly requests: Array<{ body: unknown; method: string; path: string }> = [];

	private readonly server = createServer(async (request, response) => {
		const body = await readJsonBody(request);
		this.requests.push({
			body,
			method: request.method ?? "",
			path: request.url ?? "",
		});
		response.setHeader("content-type", "application/json");
		if (request.url === "/api/operator/provider-config/connections") {
			response.end(
				JSON.stringify({
					connection: { connectionId: `connection-${this.connectionBodies().length}` },
				}),
			);
			return;
		}
		if (request.url === "/api/operator/provider-config/profiles") {
			response.end(
				JSON.stringify({ profile: { profileId: `profile-${this.profileBodies().length}` } }),
			);
			return;
		}
		response.end("{}");
	});

	baseUrl = "";

	async listen(): Promise<void> {
		await new Promise<void>((resolvePromise) => {
			this.server.listen(0, "127.0.0.1", resolvePromise);
		});
		const address = this.server.address();
		if (!address || typeof address === "string") {
			throw new Error("test server did not expose a TCP address");
		}
		this.baseUrl = `http://127.0.0.1:${address.port}`;
	}

	async close(): Promise<void> {
		await new Promise<void>((resolvePromise, reject) => {
			this.server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolvePromise();
			});
		});
	}

	connectionBodies(): unknown[] {
		return this.requests
			.filter((request) => request.path === "/api/operator/provider-config/connections")
			.map((request) => request.body);
	}

	profileBodies(): unknown[] {
		return this.requests
			.filter((request) => request.path === "/api/operator/provider-config/profiles")
			.map((request) => request.body);
	}

	validationPaths(): string[] {
		return this.requests
			.map((request) => request.path)
			.filter((path) => path.endsWith("/validate"));
	}

	activationPaths(): string[] {
		return this.requests
			.map((request) => request.path)
			.filter((path) => path.endsWith("/activate"));
	}
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	return raw ? JSON.parse(raw) : null;
}
