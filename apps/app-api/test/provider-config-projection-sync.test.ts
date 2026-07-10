// @vitest-environment node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider config projection sync script", () => {
	it("includes public_web_search in the default runtime projection roles", async () => {
		const server = new RecordingActiveProfileServer();
		const outputDir = await mkdtemp(join(tmpdir(), "provider-config-projection-"));
		const outputPath = join(outputDir, "provider-config.json");
		await server.listen();
		try {
			const result = await runProjectionSync({
				appApiBaseUrl: server.baseUrl,
				outputPath,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(server.authHeaders.every((header) => header === "internal-secret")).toBe(true);
			expect(server.roles).toContain("public_web_search");
			expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
			const written = JSON.parse(await readFile(outputPath, "utf8")) as {
				profiles: Record<string, unknown>;
				source: { roles: string[] };
			};
			expect(written.source.roles).toContain("public_web_search");
			expect(written.profiles.public_web_search).toMatchObject({
				kind: "search",
				model: "model-public_web_search",
				role: "public_web_search",
				transport: "perplexity_search",
			});
		} finally {
			await server.close();
			await rm(outputDir, { force: true, recursive: true });
		}
	}, 20_000);

	it("accepts Gemini public web search projection profiles", async () => {
		const server = new RecordingActiveProfileServer({
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			model: "gemini-2.5-flash",
			provider: "gemini",
			transport: "gemini_google_search",
		});
		const outputDir = await mkdtemp(join(tmpdir(), "provider-config-projection-"));
		const outputPath = join(outputDir, "provider-config.json");
		await server.listen();
		try {
			const result = await runProjectionSync({
				appApiBaseUrl: server.baseUrl,
				outputPath,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			const written = JSON.parse(await readFile(outputPath, "utf8")) as {
				profiles: Record<string, unknown>;
			};
			expect(written.profiles.public_web_search).toMatchObject({
				base_url: "https://generativelanguage.googleapis.com/v1beta",
				kind: "search",
				model: "gemini-2.5-flash",
				provider: "gemini",
				role: "public_web_search",
				transport: "gemini_google_search",
			});
		} finally {
			await server.close();
			await rm(outputDir, { force: true, recursive: true });
		}
	}, 20_000);
});

async function runProjectionSync(input: {
	appApiBaseUrl: string;
	outputPath: string;
}): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(
			"pnpm",
			[
				"exec",
				"tsx",
				resolve(
					__dirname,
					"../../../apps/execution-control/scripts/sync-provider-config-projection.ts",
				),
				"--app-api-base-url",
				input.appApiBaseUrl,
				"--internal-shared-secret",
				"internal-secret",
				"--output",
				input.outputPath,
			],
			{
				cwd: __dirname,
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

class RecordingActiveProfileServer {
	readonly authHeaders: string[] = [];
	readonly roles: string[] = [];

	private readonly publicWebSearchProfile: {
		baseUrl: string;
		model: string;
		provider: string;
		transport: string;
	} | null;

	constructor(
		publicWebSearchProfile: {
			baseUrl: string;
			model: string;
			provider: string;
			transport: string;
		} | null = null,
	) {
		this.publicWebSearchProfile = publicWebSearchProfile;
	}

	private readonly server = createServer(async (request, response) => {
		await drainRequest(request);
		this.authHeaders.push(String(request.headers["x-app-internal-auth"] ?? ""));
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== "/api/internal/provider-config/active") {
			response.writeHead(404, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: { code: "not_found" } }));
			return;
		}
		const role = url.searchParams.get("role") ?? "";
		this.roles.push(role);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ profile: buildProfile(role, this.publicWebSearchProfile) }));
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
}

function buildProfile(
	role: string,
	publicWebSearchProfile: {
		baseUrl: string;
		model: string;
		provider: string;
		transport: string;
	} | null = null,
): Record<string, unknown> {
	const kind =
		role === "public_web_search"
			? "search"
			: role.endsWith("_embedding")
				? "embedding"
				: role.endsWith("_reranker")
					? "rerank"
					: "prompt";
	return {
		api_key: `key-${role}`,
		base_url:
			role === "public_web_search"
				? (publicWebSearchProfile?.baseUrl ?? "https://api.perplexity.ai")
				: "https://provider.example/v1",
		dimensions: kind === "embedding" ? 2560 : undefined,
		kind,
		model:
			role === "public_web_search"
				? (publicWebSearchProfile?.model ?? `model-${role}`)
				: `model-${role}`,
		profile_id: `profile-${role}`,
		provider:
			role === "public_web_search"
				? (publicWebSearchProfile?.provider ?? "perplexity")
				: "openai-compatible",
		revision: 1,
		role,
		timeout_ms: 30000,
		transport:
			role === "public_web_search"
				? (publicWebSearchProfile?.transport ?? "perplexity_search")
				: kind === "embedding"
					? "embeddings"
					: "responses",
	};
}

async function drainRequest(request: IncomingMessage): Promise<void> {
	for await (const _chunk of request) {
		// Drain the request body so Node can reuse the socket in tests.
	}
}
