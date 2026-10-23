import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { it, type TestContext } from "node:test";
import {
	ensureLocalInfrastructureSecrets,
	loadLocalInfrastructureSecrets,
} from "./infrastructure-secrets";
import { resolveLocalQdrantConnection } from "./local-qdrant";

async function startQdrantFixture(t: TestContext) {
	const requests: { key: string; method: string | undefined; url: string | undefined }[] = [];
	const apiKey = "fixture-writer=key";
	const server = createServer((request, response) => {
		requests.push({
			key: String(request.headers["api-key"]),
			method: request.method,
			url: request.url,
		});
		response.writeHead(request.headers["api-key"] === apiKey ? 200 : 401);
		response.end(JSON.stringify({ result: { collections: [] } }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			}),
	);
	return { apiKey, port: (server.address() as AddressInfo).port, requests };
}

function createProfile(repoRoot: string, port: number) {
	const resourceKey = "deadbeef";
	const profile = {
		bucketName: "campus-agent-derived-wt-1-deadbeef",
		createdAt: "2026-09-24T00:00:00.000Z",
		databaseName: "campus_agent_wt_1_deadbeef",
		instanceId: "fixture-deadbeef",
		infraPorts: {
			objectStore: 25900,
			objectStoreConsole: 25901,
			postgres: 25432,
			qdrantGrpc: 26344,
			qdrantHttp: port,
			temporal: 27233,
			temporalUi: 27234,
		},
		infraProject: "campus-agent-wt-deadbeef",
		ports: { appApi: 27131, campusWeb: 27114, opsWeb: 5188, opsWebApi: 5189 },
		repoKey: "fixture",
		resourceKey,
		schemaVersion: 3 as const,
		slot: 1,
		sourceBucketName: "campus-agent-source-wt-1-deadbeef",
		worktreePath: repoRoot,
	};
	ensureLocalInfrastructureSecrets(repoRoot, profile);
	return profile;
}

it("uses the profile port and writer key and authenticates the local connection", async (t) => {
	const fixture = await startQdrantFixture(t);
	const repoRoot = mkdtempSync(resolve(tmpdir(), "local-qdrant-test-"));
	t.after(() => rmSync(repoRoot, { force: true, recursive: true }));
	const profile = createProfile(repoRoot, fixture.port);
	const secrets = loadLocalInfrastructureSecrets(repoRoot, profile);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		if (input.toString().includes("/collections")) {
			return new Response(JSON.stringify({ result: { collections: [] } }), {
				status:
					init?.headers && new Headers(init.headers).get("api-key") === secrets.qdrantApiKey
						? 200
						: 401,
			});
		}
		return originalFetch(input, init);
	};
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	const connection = await resolveLocalQdrantConnection(repoRoot, profile);
	assert.deepEqual(connection, {
		apiKey: secrets.qdrantApiKey,
		readOnlyApiKey: secrets.qdrantReadOnlyApiKey,
		url: `http://127.0.0.1:${fixture.port}`,
	});
});

it("rejects invalid credentials and unavailable endpoints", async (t) => {
	const repoRoot = mkdtempSync(resolve(tmpdir(), "local-qdrant-test-"));
	t.after(() => rmSync(repoRoot, { force: true, recursive: true }));
	const fixture = await startQdrantFixture(t);
	const profile = createProfile(repoRoot, fixture.port);
	const secrets = await import("./infrastructure-secrets");
	const credentials = secrets.loadLocalInfrastructureSecrets(repoRoot, profile);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) =>
		input.toString().includes("/collections")
			? new Response("unauthorized", { status: 401 })
			: originalFetch(input, init);
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	await assert.rejects(
		resolveLocalQdrantConnection(repoRoot, profile),
		/credential check failed: HTTP 401/u,
	);
	assert.ok(credentials.qdrantApiKey);
});
