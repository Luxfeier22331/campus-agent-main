import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type OfficialWebNextArtifactStore, runOfficialWebNextCapture } from "../src/index.ts";

class InMemoryArtifactStore implements OfficialWebNextArtifactStore {
	readonly writes = new Map<string, { contentType: string; data: Uint8Array; text: string }>();

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}) {
		const text = new TextDecoder().decode(input.data);
		this.writes.set(input.objectKey, {
			contentType: input.contentType,
			data: input.data,
			text,
		});
		return {
			objectKey: input.objectKey,
			contentSha256: `test-sha-${input.objectKey}`,
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

describe("official-web-next capture", () => {
	let closeServer: (() => Promise<void>) | undefined;

	afterEach(async () => {
		if (closeServer) {
			await closeServer();
			closeServer = undefined;
		}
	});

	it("captures explicit workset pages as source truth without target or consumer fields", async () => {
		const fixture = await startFixtureServer({
			"/": htmlPage({
				body: `
					<header><a href="/about.html">About</a></header>
					<main>
						<h1>Campus Overview</h1>
						<p>The university has a public campus guide.</p>
						<table><tr><td>Office</td><td>Room 101</td></tr></table>
						<a href="/detail.html">Read details</a>
						<a href="https://outside.example.net/">External</a>
					</main>
				`,
				title: "Campus Overview",
			}),
		});
		closeServer = fixture.close;
		const artifactStore = new InMemoryArtifactStore();

		const result = await runOfficialWebNextCapture({
			artifactStore,
			limits: {
				maxConcurrency: 1,
				maxRequests: 5,
				sameDomainDelayMs: 0,
			},
			runId: "ow-next-run-001",
			siteId: "muc_public",
			workset: [
				{
					discoveryMethod: "seed",
					host: fixture.host,
					url: fixture.url("/"),
				},
			],
		});

		expect(result.pagesFetched).toBe(1);
		expect(result.pagesFailed).toBe(0);
		expect(result.sourceTruthBundleRef.objectKey).toBe(
			"official_web_next/muc_public/runs/ow-next-run-001/source-truth-bundle.json",
		);

		const bundleText = artifactStore.writes.get(result.sourceTruthBundleRef.objectKey)?.text;
		expect(bundleText).toBeDefined();
		const bundle = JSON.parse(bundleText ?? "{}") as {
			pages: Array<{
				contentBlocksObjectKey: string;
				discoveredLinksObjectKey: string;
				pageManifestObjectKey: string;
				responseHtmlObjectKey: string;
			}>;
		};
		expect(bundle.pages).toHaveLength(1);

		const page = bundle.pages[0];
		expect(artifactStore.writes.get(page.responseHtmlObjectKey)?.text).toContain("Campus Overview");
		const manifestText = artifactStore.writes.get(page.pageManifestObjectKey)?.text;
		const blocksText = artifactStore.writes.get(page.contentBlocksObjectKey)?.text;
		const linksText = artifactStore.writes.get(page.discoveredLinksObjectKey)?.text;

		expect(manifestText).toBeDefined();
		expect(blocksText).toContain("Campus Overview");
		expect(blocksText).toContain("Office");
		expect(blocksText).toContain(fixture.url("/detail.html"));
		expect(linksText).toContain(fixture.url("/detail.html"));
		expect(linksText).toContain("outside.example.net");

		const serializedOutputs = [...artifactStore.writes.values()]
			.map((item) => item.text)
			.join("\n");
		expect(serializedOutputs).not.toContain("consumerFamily");
		expect(serializedOutputs).not.toContain("selectedWriteTarget");
		expect(serializedOutputs).not.toContain("materializationPolicy");
		expect(serializedOutputs).not.toContain("reviewPolicy");
		expect(serializedOutputs).not.toContain("targetJobId");
		expect(serializedOutputs).not.toContain("targetCandidateId");
	});

	it("rejects browser render mode until a Playwright path is explicitly implemented", async () => {
		const artifactStore = new InMemoryArtifactStore();

		await expect(
			runOfficialWebNextCapture({
				artifactStore,
				runId: "ow-next-run-browser",
				siteId: "muc_public",
				workset: [
					{
						discoveryMethod: "seed",
						host: "www.example.edu",
						renderMode: "browser",
						url: "https://www.example.edu/",
					},
				],
			}),
		).rejects.toThrow(/browser render mode is not implemented/u);
	});
});

function htmlPage(input: { body: string; title: string }): string {
	return `<!doctype html>
<html lang="en">
<head><title>${input.title}</title></head>
<body>${input.body}</body>
</html>`;
}

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
			"content-language": "en",
			"content-type": "text/html; charset=utf-8",
			etag: `"${pathname}"`,
			"last-modified": "Wed, 08 Jul 2026 00:00:00 GMT",
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
