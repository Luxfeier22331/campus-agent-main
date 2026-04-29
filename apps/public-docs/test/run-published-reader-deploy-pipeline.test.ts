import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PublicDocsReleaseLedger } from "../scripts/check-published-reader-manifest";
import {
	type PublicDocsDeployPipelineCommandSpec,
	parsePublishedReaderDeployPipelineArgs,
	runPublishedReaderDeployPipeline,
} from "../scripts/run-published-reader-deploy-pipeline";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-deploy-pipeline-"));
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

function objectStoreWithManifest(content: string): FakeObjectStore {
	return new FakeObjectStore(new Map([["manifest.json", content]]));
}

function readLedger(path: string): PublicDocsReleaseLedger {
	return JSON.parse(readFileSync(path, "utf8")) as PublicDocsReleaseLedger;
}

function deploymentCommands(): PublicDocsDeployPipelineCommandSpec[] {
	return [
		{ args: ["build"], command: "pnpm", phase: "build" },
		{ args: ["smoke"], command: "pnpm", phase: "smoke" },
		{ args: ["deploy"], command: "pnpm", phase: "deploy" },
	];
}

describe("published reader deploy pipeline", () => {
	it("runs build, smoke and deploy for a changed manifest and appends deployed ledger", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		const executed: PublicDocsDeployPipelineCommandSpec[] = [];

		const result = await runPublishedReaderDeployPipeline({
			client: objectStoreWithManifest(manifest()),
			commandRunner: async (command) => {
				expect(existsSync(lockFilePath)).toBe(true);
				executed.push(command);
				return {
					exitCode: 0,
					stderr: "",
					stdout:
						command.phase === "deploy"
							? "Deployment ID: cf-deploy-123\nVersion ID: cf-version-456\n"
							: "",
				};
			},
			commands: deploymentCommands(),
			environment: "staging",
			force: true,
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
			runnerId: "runner-a",
		});

		expect(result.outcome).toBe("deployed");
		expect(executed.map((command) => command.phase)).toEqual(["build", "smoke", "deploy"]);
		expect(result.cloudflareDeploymentId).toBe("cf-deploy-123");
		expect(result.cloudflareVersionId).toBe("cf-version-456");

		const ledger = readLedger(ledgerFilePath);
		expect(ledger.records).toHaveLength(2);
		expect(ledger.records[0]).toMatchObject({
			status: "validating",
			trigger: "forced",
		});
		expect(ledger.records[1]).toMatchObject({
			cloudflareDeploymentId: "cf-deploy-123",
			cloudflareVersionId: "cf-version-456",
			status: "deployed",
			trigger: "forced",
		});
	});

	it("skips deployment commands when the manifest digest is already deployed", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		const currentManifest = manifest();
		const digest = sha256Hex(currentManifest);
		writeFileSync(
			ledgerFilePath,
			JSON.stringify({
				records: [
					{
						candidateManifestDigest: digest,
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
		);
		const executed: PublicDocsDeployPipelineCommandSpec[] = [];

		const result = await runPublishedReaderDeployPipeline({
			client: objectStoreWithManifest(currentManifest),
			commandRunner: async (command) => {
				executed.push(command);
				return { exitCode: 0, stderr: "", stdout: "" };
			},
			commands: deploymentCommands(),
			environment: "prod",
			force: true,
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
		});

		expect(result.outcome).toBe("not_changed");
		expect(executed).toEqual([]);
		expect(readLedger(ledgerFilePath).records.at(-1)).toMatchObject({
			candidateManifestDigest: digest,
			status: "skipped",
		});
	});

	it("stops at the first failed command and appends failed ledger", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		const executed: PublicDocsDeployPipelineCommandSpec[] = [];

		const result = await runPublishedReaderDeployPipeline({
			client: objectStoreWithManifest(manifest()),
			commandRunner: async (command) => {
				executed.push(command);
				if (command.phase === "smoke") {
					return { exitCode: 1, stderr: "smoke failed", stdout: "" };
				}
				return { exitCode: 0, stderr: "", stdout: "" };
			},
			commands: deploymentCommands(),
			environment: "prod",
			force: true,
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
		});

		expect(result.outcome).toBe("failed");
		expect(executed.map((command) => command.phase)).toEqual(["build", "smoke"]);
		expect(readLedger(ledgerFilePath).records.at(-1)).toMatchObject({
			failureReason: "smoke failed",
			status: "failed",
		});
	});

	it("records failed ledger when a command runner throws", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");

		const result = await runPublishedReaderDeployPipeline({
			client: objectStoreWithManifest(manifest()),
			commandRunner: async () => {
				throw new Error("spawn failed");
			},
			commands: deploymentCommands(),
			environment: "prod",
			force: true,
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
		});

		expect(result.outcome).toBe("failed");
		expect(existsSync(lockFilePath)).toBe(false);
		expect(readLedger(ledgerFilePath).records.at(-1)).toMatchObject({
			failureReason: "spawn failed",
			status: "failed",
		});
	});

	it("does not run commands for invalid manifests", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		const executed: PublicDocsDeployPipelineCommandSpec[] = [];

		const result = await runPublishedReaderDeployPipeline({
			client: objectStoreWithManifest('{"entries":'),
			commandRunner: async (command) => {
				executed.push(command);
				return { exitCode: 0, stderr: "", stdout: "" };
			},
			commands: deploymentCommands(),
			environment: "prod",
			force: true,
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
		});

		expect(result.outcome).toBe("not_deployable");
		expect(executed).toEqual([]);
		expect(readLedger(ledgerFilePath).records.at(-1)).toMatchObject({
			status: "failed",
		});
	});

	it("plans commands without executing them in dry-run mode", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		const executed: PublicDocsDeployPipelineCommandSpec[] = [];

		const result = await runPublishedReaderDeployPipeline({
			client: objectStoreWithManifest(manifest()),
			commandRunner: async (command) => {
				executed.push(command);
				return { exitCode: 0, stderr: "", stdout: "" };
			},
			commands: deploymentCommands(),
			dryRun: true,
			environment: "prod",
			force: true,
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
		});

		expect(result.outcome).toBe("dry_run");
		expect(result.plannedCommands.map((command) => command.phase)).toEqual([
			"build",
			"smoke",
			"deploy",
		]);
		expect(executed).toEqual([]);
	});

	it("accepts pnpm script separators in deploy pipeline args", () => {
		expect(
			parsePublishedReaderDeployPipelineArgs([
				"--dry-run",
				"--",
				"--env",
				"staging",
				"--force",
				"--ledger",
				"ledger.json",
				"--lock-file",
				"lock.json",
			]),
		).toMatchObject({
			dryRun: true,
			environment: "staging",
			force: true,
			ledgerFilePath: "ledger.json",
			lockFilePath: "lock.json",
		});
	});
});
