import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runOfficialWebNextLocalHarness } from "../src/index.ts";

describe("official-web-next local harness", () => {
	let closeServer: (() => Promise<void>) | undefined;

	afterEach(async () => {
		if (closeServer) {
			await closeServer();
			closeServer = undefined;
		}
	});

	it("runs capture and reference artifact generation from an explicit workset file", async () => {
		const fixture = await startFixtureServer({
			"/": "<!doctype html><html><head><title>Catalog</title></head><body><main><h1>Catalog</h1><p>Reference text.</p></main></body></html>",
		});
		closeServer = fixture.close;
		const rootDir = await mkdtemp(join(tmpdir(), "official-web-next-harness-"));
		const worksetPath = join(rootDir, "workset.json");
		await writeFile(
			worksetPath,
			JSON.stringify([
				{
					discoveryMethod: "seed",
					host: fixture.host,
					url: fixture.url("/"),
				},
			]),
		);

		const result = await runOfficialWebNextLocalHarness({
			artifactRootDir: join(rootDir, "artifacts"),
			crawlPolicy: {
				respectRobots: false,
			},
			releaseId: "candidate-release-001",
			runId: "ow-next-run-001",
			siteId: "muc_public",
			worksetPath,
		});

		expect(result.capture.pagesFetched).toBe(1);
		expect(result.reference.documentUnits).toHaveLength(1);
		expect(result.reference.chunks).toHaveLength(1);
		expect(result.referenceArtifactRefs.map((ref) => ref.objectKey)).toContain(
			"official_web_next/muc_public/runs/ow-next-run-001/reference/release-manifest.json",
		);
		await expect(
			readFile(
				join(
					rootDir,
					"artifacts",
					"official_web_next/muc_public/runs/ow-next-run-001/reference/release-manifest.json",
				),
				"utf8",
			),
		).resolves.toContain('"aliasPublished": false');
	});
});

async function startFixtureServer(routes: Record<string, string>) {
	const server = createServer((request: IncomingMessage, response: ServerResponse) => {
		const pathname = new URL(request.url ?? "/", "http://fixture.local").pathname;
		const body = routes[pathname];
		if (body == null) {
			response.writeHead(404, { "content-type": "text/plain" });
			response.end("not found");
			return;
		}
		response.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
		});
		response.end(body);
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	const origin = `http://127.0.0.1:${address.port}`;
	return {
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
		host: "127.0.0.1",
		url: (path: string) => `${origin}${path}`,
	};
}
