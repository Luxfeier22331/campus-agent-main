import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PublicDocsReleaseLedger } from "../scripts/check-published-reader-manifest";
import { retryPublishedReaderRelease } from "../scripts/retry-published-reader-release";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-retry-"));
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

describe("retry published reader release", () => {
	it("retries a failed current candidate with retry metadata", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		const currentManifest = manifest();
		const digest = sha256Hex(currentManifest);
		writeFileSync(
			ledgerFilePath,
			`${JSON.stringify({
				records: [
					{
						candidateManifestDigest: digest,
						candidateReleaseId: "release-a",
						completedAt: "2026-04-29T10:05:00.000Z",
						environment: "prod",
						failureReason: "deploy failed",
						id: "failed-1",
						startedAt: "2026-04-29T10:00:00.000Z",
						status: "failed",
						surface: "public_docs",
						validation: { errors: [], ok: true, warnings: [] },
					},
				],
				version: 1,
			} satisfies PublicDocsReleaseLedger)}\n`,
		);

		const result = await retryPublishedReaderRelease({
			client: new FakeObjectStore(new Map([["manifest.json", currentManifest]])),
			commandRunner: async () => ({ exitCode: 0, stderr: "", stdout: "Version ID: version-a" }),
			commands: [{ args: ["deploy"], command: "pnpm", phase: "deploy" }],
			environment: "prod",
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T11:00:00.000Z",
			recordId: "failed-1",
		});

		expect(result.outcome).toBe("deployed");
		expect(readLedger(ledgerFilePath).records.at(-1)).toMatchObject({
			attemptNumber: 1,
			retryOfRecordId: "failed-1",
			status: "deployed",
		});
	});

	it("rejects stale failed candidates before running commands", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		writeFileSync(
			ledgerFilePath,
			`${JSON.stringify({
				records: [
					{
						candidateManifestDigest: "digest-old",
						candidateReleaseId: "release-a",
						completedAt: "2026-04-29T10:05:00.000Z",
						environment: "prod",
						failureReason: "deploy failed",
						id: "failed-1",
						startedAt: "2026-04-29T10:00:00.000Z",
						status: "failed",
						surface: "public_docs",
						validation: { errors: [], ok: true, warnings: [] },
					},
				],
				version: 1,
			} satisfies PublicDocsReleaseLedger)}\n`,
		);
		const executed: string[] = [];

		const result = await retryPublishedReaderRelease({
			client: new FakeObjectStore(new Map([["manifest.json", manifest()]])),
			commandRunner: async () => {
				executed.push("ran");
				return { exitCode: 0, stderr: "", stdout: "" };
			},
			environment: "prod",
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T11:00:00.000Z",
			recordId: "failed-1",
		});

		expect(result).toMatchObject({
			outcome: "not_retryable",
			retryDecision: { reason: "candidate_digest_not_current" },
		});
		expect(executed).toEqual([]);
	});
});
