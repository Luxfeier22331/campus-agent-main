import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PublicDocsReleaseLedger } from "../scripts/check-published-reader-manifest";
import {
	nudgePublishedReaderDeployHook,
	parsePublishedReaderDeployHookArgs,
	triggerCloudflareDeployHook,
	validatePublishedReaderDeployHookPayload,
} from "../scripts/nudge-published-reader-deploy-hook";
import type { PublicDocsDeployPipelineCommandSpec } from "../scripts/run-published-reader-deploy-pipeline";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-deploy-hook-"));
	temporaryDirectories.push(directory);
	return directory;
}

function manifest(generatedAt = "2026-04-29T10:00:00.000Z"): string {
	return JSON.stringify({
		entries: [],
		generatedAt,
		surface: "public_docs",
	});
}

function sha256Hex(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function readLedger(path: string): PublicDocsReleaseLedger {
	return JSON.parse(readFileSync(path, "utf8")) as PublicDocsReleaseLedger;
}

function deploymentCommands(): PublicDocsDeployPipelineCommandSpec[] {
	return [{ args: ["deploy"], command: "pnpm", phase: "deploy" }];
}

describe("published reader deploy hook nudger", () => {
	it("rejects non-public-docs hook payloads before running a pipeline", () => {
		expect(() =>
			validatePublishedReaderDeployHookPayload({
				environment: "prod",
				payload: { surface: "student_rules" },
			}),
		).toThrow("surface=public_docs");
	});

	it("rejects payload environment mismatches before running a pipeline", () => {
		expect(() =>
			validatePublishedReaderDeployHookPayload({
				environment: "prod",
				payload: { environment: "staging", surface: "public_docs" },
			}),
		).toThrow("payload environment staging does not match runner environment prod");
	});

	it("rejects shared secret mismatches before running a pipeline", () => {
		expect(() =>
			validatePublishedReaderDeployHookPayload({
				environment: "prod",
				expectedSecret: "expected-secret",
				payload: { surface: "public_docs" },
				payloadSecret: "wrong-secret",
			}),
		).toThrow("deploy hook secret mismatch");
	});

	it("normalizes only nudge metadata and ignores payload release truth fields", () => {
		const normalized = validatePublishedReaderDeployHookPayload({
			environment: "prod",
			payload: {
				branch: "main",
				environment: "prod",
				eventId: "evt-1",
				manifestDigest: "payload-digest",
				manifestObjectKey: "payload-manifest.json",
				releaseId: "payload-release",
				source: { kind: "ingestion" },
				surface: "public_docs",
			},
		});

		expect(normalized).toEqual({
			environment: "prod",
			eventId: "evt-1",
			source: { kind: "ingestion" },
			surface: "public_docs",
		});
		expect(normalized).not.toHaveProperty("manifestDigest");
		expect(normalized).not.toHaveProperty("manifestObjectKey");
		expect(normalized).not.toHaveProperty("releaseId");
		expect(normalized).not.toHaveProperty("branch");
	});

	it("runs the controlled local deploy pipeline with hook trigger and trusted manifest input", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		const trustedManifest = manifest();
		const executed: PublicDocsDeployPipelineCommandSpec[] = [];

		const result = await nudgePublishedReaderDeployHook({
			client: new FakeObjectStore(new Map([["trusted-manifest.json", trustedManifest]])),
			commandRunner: async (command) => {
				executed.push(command);
				return { exitCode: 0, stderr: "", stdout: "Version ID: version-hook" };
			},
			commands: deploymentCommands(),
			environment: "prod",
			expectedSecret: "expected-secret",
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "trusted-manifest.json",
			now: "2026-04-29T11:00:00.000Z",
			payload: {
				branch: "payload-branch",
				environment: "prod",
				eventId: "evt-1",
				manifestDigest: "payload-digest",
				manifestObjectKey: "payload-manifest.json",
				releaseId: "payload-release",
				secret: "expected-secret",
				surface: "public_docs",
			},
			runnerId: "hook-runner",
		});

		expect(result.mode).toBe("local_pipeline");
		if (result.mode !== "local_pipeline") {
			throw new Error("expected local pipeline nudge result");
		}
		expect(result.payload).toMatchObject({ eventId: "evt-1", surface: "public_docs" });
		expect(result.deployResult?.outcome).toBe("deployed");
		expect(result.deployResult?.checkResult.check?.candidateManifestDigest).toBe(
			sha256Hex(trustedManifest),
		);
		expect(executed.map((command) => command.phase)).toEqual(["deploy"]);

		const ledger = readLedger(ledgerFilePath);
		expect(ledger.records[0]).toMatchObject({
			candidateManifestDigest: sha256Hex(trustedManifest),
			runnerId: "hook-runner",
			status: "validating",
			trigger: "hook",
		});
		expect(ledger.records[1]).toMatchObject({
			status: "deployed",
			trigger: "hook",
		});
	});

	it("dispatches a Cloudflare deploy hook through injected fetch without running a local pipeline", async () => {
		const calls: Array<{ init?: RequestInit; url: string }> = [];

		const result = await nudgePublishedReaderDeployHook({
			deployHookUrl: "https://api.cloudflare.com/client/v4/deploy_hooks/hook-id",
			environment: "staging",
			fetchImpl: async (url, init) => {
				calls.push({ init, url: String(url) });
				return new Response(JSON.stringify({ id: "build-1" }), { status: 200 });
			},
			payload: { environment: "staging", eventId: "evt-2", surface: "public_docs" },
		});

		expect(result.mode).toBe("cloudflare_deploy_hook");
		if (result.mode !== "cloudflare_deploy_hook") {
			throw new Error("expected Cloudflare deploy hook nudge result");
		}
		expect(result.dispatchResult).toMatchObject({ ok: true, status: 200 });
		expect(calls).toEqual([
			{
				init: {
					body: JSON.stringify({
						environment: "staging",
						eventId: "evt-2",
						surface: "public_docs",
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
				url: "https://api.cloudflare.com/client/v4/deploy_hooks/hook-id",
			},
		]);
	});

	it("posts to the Cloudflare deploy hook URL and returns response metadata", async () => {
		const calls: Array<{ init?: RequestInit; url: string }> = [];

		const result = await triggerCloudflareDeployHook({
			deployHookUrl: "https://api.cloudflare.com/client/v4/deploy_hooks/hook-id",
			fetchImpl: async (url, init) => {
				calls.push({ init, url: String(url) });
				return new Response("queued", { status: 202 });
			},
			payload: { environment: "prod", eventId: "evt-3", surface: "public_docs" },
		});

		expect(result).toEqual({
			body: "queued",
			ok: true,
			status: 202,
		});
		expect(calls[0]?.init?.method).toBe("POST");
	});

	it("parses CLI args for payload, secret, dispatch and local pipeline settings", () => {
		const directory = createTempDir();
		const payloadPath = join(directory, "payload.json");
		writeFileSync(payloadPath, '{"surface":"public_docs"}\n');

		expect(
			parsePublishedReaderDeployHookArgs([
				"--env",
				"staging",
				"--payload-json",
				'{"surface":"public_docs","eventId":"evt-4"}',
				"--payload-path",
				payloadPath,
				"--secret",
				"expected-secret",
				"--payload-secret",
				"actual-secret",
				"--deploy-hook-url",
				"https://api.cloudflare.com/client/v4/deploy_hooks/hook-id",
				"--dry-run",
				"--ledger",
				"ledger.json",
				"--lock-file",
				"lock.json",
				"--lock-stale-ms",
				"60000",
				"--manifest-key",
				"trusted-manifest.json",
				"--now",
				"2026-04-29T11:00:00.000Z",
			]),
		).toMatchObject({
			deployHookUrl: "https://api.cloudflare.com/client/v4/deploy_hooks/hook-id",
			dryRun: true,
			environment: "staging",
			expectedSecret: "expected-secret",
			ledgerFilePath: "ledger.json",
			lockFilePath: "lock.json",
			lockStaleMs: 60000,
			manifestObjectKey: "trusted-manifest.json",
			now: "2026-04-29T11:00:00.000Z",
			payloadFilePath: payloadPath,
			payloadJson: '{"surface":"public_docs","eventId":"evt-4"}',
			payloadSecret: "actual-secret",
		});
	});
});
