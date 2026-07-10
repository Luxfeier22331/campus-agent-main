import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

async function runSelfTest(): Promise<number> {
	await testProviderProjectionSync();
	await testObservabilityProjectionSync();
	console.log("check_projection_sync_helpers self-test passed.");
	return 0;
}

async function testProviderProjectionSync(): Promise<void> {
	const authHeaders: string[] = [];
	await withServer(
		(request, response) => {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			const role = url.searchParams.get("role") ?? "";
			authHeaders.push(String(request.headers["x-app-internal-auth"] ?? ""));
			writeJson(response, { profile: profileForRole(role) });
		},
		async (baseUrl) => {
			await withTempDir(async (tempDir) => {
				const output = join(tempDir, "provider-projection.json");
				const result = await runNodeCommand([
					"apps/execution-control/scripts/sync-provider-config-projection.ts",
					"--app-api-base-url",
					baseUrl,
					"--internal-shared-secret",
					"internal-secret",
					"--output",
					output,
					"--role",
					"eval_ragas_llm",
					"--role",
					"eval_ragas_embedding",
				]);
				expect(result.status === 0, result.stderr || result.stdout);
				const payload = JSON.parse(readFileSync(output, "utf8"));
				expect(
					payload.schema_version === "provider_config_projection.v1",
					"provider schema mismatch",
				);
				expectJsonEqual(Object.keys(payload.profiles).sort(), [
					"eval_ragas_embedding",
					"eval_ragas_llm",
				]);
				expect(ownerOnlyMode(output), "provider projection output mode mismatch");
			});
		},
	);
	expectJsonEqual(authHeaders, ["internal-secret", "internal-secret"]);
}

async function testObservabilityProjectionSync(): Promise<void> {
	const authHeaders: string[] = [];
	await withServer(
		(_request, response) => {
			authHeaders.push(String(_request.headers["x-app-internal-auth"] ?? ""));
			writeJson(response, {
				config: {
					schema_version: "llm_debug_trace_config.v1",
					mode: "langfuse_otlp",
					include_model_io: false,
					sample_ratio: 1,
					langfuse_otlp: {
						endpoint: "https://cloud.langfuse.com/api/public/otel",
						auth_header: "Basic langfuse-secret",
						public_trace_base_url: "https://cloud.langfuse.com/project/demo/traces",
					},
				},
			});
		},
		async (baseUrl) => {
			await withTempDir(async (tempDir) => {
				const output = join(tempDir, "observability-projection.json");
				const result = await runNodeCommand([
					"apps/execution-control/scripts/sync-observability-config-projection.ts",
					"--app-api-base-url",
					baseUrl,
					"--internal-shared-secret",
					"internal-secret",
					"--output",
					output,
				]);
				expect(result.status === 0, result.stderr || result.stdout);
				const payload = JSON.parse(readFileSync(output, "utf8"));
				expect(
					payload.schema_version === "observability_config_projection.v1",
					"observability schema mismatch",
				);
				expect(
					payload.llm_debug_trace.schema_version === "llm_debug_trace_config.v1",
					"llm debug trace schema mismatch",
				);
				expect(
					payload.llm_debug_trace.langfuse_otlp.auth_header === "Basic langfuse-secret",
					"auth header not persisted in private projection",
				);
				expect(ownerOnlyMode(output), "observability projection output mode mismatch");
				expect(!result.stdout.includes("Basic langfuse-secret"), "auth header leaked to stdout");
				expect(!result.stderr.includes("Basic langfuse-secret"), "auth header leaked to stderr");
			});
		},
	);
	expectJsonEqual(authHeaders, ["internal-secret"]);
}

async function runNodeCommand(args: string[]): Promise<{
	status: number;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolveCommand, rejectCommand) => {
		const child = spawn("node", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			rejectCommand(new Error(`node ${args.join(" ")} timed out\n${stdout}\n${stderr}`));
		}, 10_000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			rejectCommand(error);
		});
		child.on("close", (status) => {
			clearTimeout(timeout);
			resolveCommand({ status: status ?? 1, stdout, stderr });
		});
	});
}

function profileForRole(role: string): Record<string, unknown> {
	const kind = role.endsWith("_embedding") ? "embedding" : "prompt";
	const profile: Record<string, unknown> = {
		api_key: `${role}-key`,
		base_url: "https://provider.example/v1",
		kind,
		model: kind === "embedding" ? "Qwen3-Embedding-4B" : "gpt-5.4",
		profile_id: `provider_profile_${role}`,
		provider: "openai-compatible",
		revision: 3,
		role,
		timeout_ms: 30000,
		transport: kind === "embedding" ? "embeddings" : "responses",
	};
	if (kind === "embedding") {
		profile.dimensions = 2560;
	}
	return profile;
}

async function withServer(
	handler: (request: IncomingMessage, response: ServerResponse) => void,
	callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
	const server = createServer(handler);
	await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("test server did not bind to a TCP port");
	}
	try {
		await callback(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolveClose, rejectClose) =>
			server.close((error) => (error ? rejectClose(error) : resolveClose())),
		);
	}
}

function writeJson(response: ServerResponse, payload: unknown): void {
	response.writeHead(200, { connection: "close", "content-type": "application/json" });
	response.end(JSON.stringify(payload));
}

async function withTempDir(callback: (path: string) => Promise<void>): Promise<void> {
	const path = mkdtempSync(join(tmpdir(), "projection-sync-"));
	try {
		await callback(path);
	} finally {
		rmSync(path, { recursive: true, force: true });
	}
}

function ownerOnlyMode(path: string): boolean {
	return (statSync(path).mode & 0o777) === 0o600;
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectJsonEqual(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function main(argv: string[]): Promise<number> {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	return runSelfTest();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
