// @vitest-environment node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("observability config projection sync script", () => {
	it("writes the private projection without leaking its auth header", async () => {
		const authHeaders: string[] = [];
		const server = createServer((request, response) => {
			authHeaders.push(String(request.headers["x-app-internal-auth"] ?? ""));
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					config: {
						include_model_io: false,
						langfuse_otlp: {
							auth_header: "Basic langfuse-secret",
							endpoint: "https://cloud.langfuse.com/api/public/otel",
							public_trace_base_url: "https://cloud.langfuse.com/project/demo/traces",
						},
						mode: "langfuse_otlp",
						sample_ratio: 1,
						schema_version: "llm_debug_trace_config.v1",
					},
				}),
			);
		});
		const outputDir = await mkdtemp(join(tmpdir(), "observability-config-projection-"));
		const outputPath = join(outputDir, "observability.json");
		await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("test server did not expose a TCP address");
		}
		try {
			const result = await runProjectionSync({
				appApiBaseUrl: `http://127.0.0.1:${address.port}`,
				outputPath,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).not.toContain("Basic langfuse-secret");
			expect(authHeaders).toEqual(["internal-secret"]);
			expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
			expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({
				llm_debug_trace: {
					langfuse_otlp: { auth_header: "Basic langfuse-secret" },
					mode: "langfuse_otlp",
				},
				schema_version: "observability_config_projection.v1",
			});
		} finally {
			await new Promise<void>((resolveClose, rejectClose) =>
				server.close((error) => (error ? rejectClose(error) : resolveClose())),
			);
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
					"../../../apps/execution-control/scripts/sync-observability-config-projection.ts",
				),
				"--app-api-base-url",
				input.appApiBaseUrl,
				"--internal-shared-secret",
				"internal-secret",
				"--output",
				input.outputPath,
			],
			{ cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] },
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
