import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PublicDocsReleaseLedger } from "../scripts/check-published-reader-manifest";
import type { PublicDocsDeployPipelineCommandSpec } from "../scripts/run-published-reader-deploy-pipeline";
import {
	parsePublishedReaderRollingPublishCiArgs,
	runPublishedReaderRollingPublishCi,
} from "../scripts/run-published-reader-rolling-publish-ci";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-rolling-ci-"));
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

function deploymentCommands(): PublicDocsDeployPipelineCommandSpec[] {
	return [{ args: ["deploy"], command: "pnpm", phase: "deploy" }];
}

async function readLedgerObject(
	store: FakeObjectStore,
	key: string,
): Promise<PublicDocsReleaseLedger> {
	return JSON.parse(await store.readTextObject({ key })) as PublicDocsReleaseLedger;
}

describe("published reader rolling publish CI runner", () => {
	it("returns disabled without requiring object-store or deploy configuration", async () => {
		const result = await runPublishedReaderRollingPublishCi({
			enabled: false,
			environment: "prod",
			now: "2026-04-29T12:00:00.000Z",
		});

		expect(result).toMatchObject({
			enabled: false,
			environment: "prod",
			ledgerDownloaded: false,
			ledgerUploaded: false,
			outcome: "disabled",
		});
	});

	it("downloads a missing persisted ledger as empty and uploads the final ledger after deploy", async () => {
		const directory = createTempDir();
		const store = new FakeObjectStore(new Map([["manifest.json", manifest()]]));

		const result = await runPublishedReaderRollingPublishCi({
			client: store,
			commandRunner: async () => ({
				exitCode: 0,
				stderr: "",
				stdout: "Deployment ID: cf-deploy\nVersion ID: cf-version\n",
			}),
			commands: deploymentCommands(),
			enabled: true,
			environment: "prod",
			ledgerFilePath: join(directory, "ledger.json"),
			ledgerObjectKey: "public-docs/prod/ledger.json",
			lockFilePath: join(directory, "lock.json"),
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T12:00:00.000Z",
			force: true,
		});

		expect(result).toMatchObject({
			enabled: true,
			ledgerDownloaded: false,
			ledgerUploaded: true,
			outcome: "deployed",
		});
		const ledger = await readLedgerObject(store, "public-docs/prod/ledger.json");
		expect(ledger.records).toHaveLength(2);
		expect(ledger.records.at(-1)).toMatchObject({
			candidateManifestDigest: sha256Hex(manifest()),
			cloudflareVersionId: "cf-version",
			status: "deployed",
		});
	});

	it("uses persisted deployed ledger state to skip unchanged manifests", async () => {
		const directory = createTempDir();
		const currentManifest = manifest();
		const store = new FakeObjectStore(
			new Map([
				["manifest.json", currentManifest],
				[
					"public-docs/prod/ledger.json",
					JSON.stringify({
						records: [
							{
								candidateManifestDigest: sha256Hex(currentManifest),
								candidateReleaseId: "release-current",
								completedAt: "2026-04-29T10:10:00.000Z",
								environment: "prod",
								id: "record-1",
								startedAt: "2026-04-29T10:00:00.000Z",
								status: "deployed",
								surface: "public_docs",
								validation: { errors: [], ok: true, warnings: [] },
							},
						],
						version: 1,
					} satisfies PublicDocsReleaseLedger),
				],
			]),
		);

		const result = await runPublishedReaderRollingPublishCi({
			client: store,
			commands: deploymentCommands(),
			enabled: true,
			environment: "prod",
			ledgerFilePath: join(directory, "ledger.json"),
			ledgerObjectKey: "public-docs/prod/ledger.json",
			lockFilePath: join(directory, "lock.json"),
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T12:00:00.000Z",
			force: true,
		});

		expect(result).toMatchObject({
			ledgerDownloaded: true,
			ledgerUploaded: true,
			outcome: "not_changed",
		});
		const ledger = await readLedgerObject(store, "public-docs/prod/ledger.json");
		expect(ledger.records.at(-1)).toMatchObject({
			candidateManifestDigest: sha256Hex(currentManifest),
			status: "skipped",
		});
	});

	it("does not upload dry-run ledger changes to persisted storage", async () => {
		const directory = createTempDir();
		const store = new FakeObjectStore(new Map([["manifest.json", manifest()]]));

		const result = await runPublishedReaderRollingPublishCi({
			client: store,
			commands: deploymentCommands(),
			dryRun: true,
			enabled: true,
			environment: "prod",
			ledgerFilePath: join(directory, "ledger.json"),
			ledgerObjectKey: "public-docs/prod/ledger.json",
			lockFilePath: join(directory, "lock.json"),
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T12:00:00.000Z",
			force: true,
		});

		expect(result).toMatchObject({
			ledgerDownloaded: false,
			ledgerUploaded: false,
			outcome: "dry_run",
		});
		await expect(store.readTextObject({ key: "public-docs/prod/ledger.json" })).rejects.toThrow(
			"missing object",
		);
		expect(existsSync(join(directory, "ledger.json"))).toBe(true);
	});

	it("fails closed when enabled deploy lacks a persisted ledger key", async () => {
		await expect(
			runPublishedReaderRollingPublishCi({
				client: new FakeObjectStore(new Map([["manifest.json", manifest()]])),
				enabled: true,
				environment: "prod",
				manifestObjectKey: "manifest.json",
			}),
		).rejects.toThrow("ledgerObjectKey is required when rolling publish is enabled");
	});

	it("parses CI args and environment gates", () => {
		const parsed = parsePublishedReaderRollingPublishCiArgs(
			["--env", "staging", "--dry-run", "--force", "--output", "result.json"],
			{
				PUBLIC_DOCS_RELEASE_LEDGER_KEY: "public-docs/staging/ledger.json",
				PUBLIC_DOCS_ROLLING_PUBLISH_ENABLED: "true",
				PUBLIC_DOCS_SYNC_MANIFEST_KEY: "manifest.json",
			},
		);

		expect(parsed).toMatchObject({
			dryRun: true,
			enabled: true,
			environment: "staging",
			force: true,
			ledgerObjectKey: "public-docs/staging/ledger.json",
			manifestObjectKey: "manifest.json",
			outputPath: "result.json",
		});
	});
});
