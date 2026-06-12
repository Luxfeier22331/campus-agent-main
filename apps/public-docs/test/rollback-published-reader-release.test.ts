import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type {
	PublicDocsReleaseLedger,
	PublicDocsReleaseLedgerRecord,
} from "../scripts/check-published-reader-manifest";
import {
	type PublicDocsRollbackCommandSpec,
	parseRollbackPublishedReaderReleaseArgs,
	resolvePublicDocsRollbackTarget,
	rollbackPublishedReaderRelease,
} from "../scripts/rollback-published-reader-release";
import { temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-rollback-"));
	temporaryDirectories.push(directory);
	return directory;
}

function deployedRecord(input: {
	digest: string;
	id: string;
	releaseId: string;
	startedAt: string;
	versionId?: string;
}): PublicDocsReleaseLedgerRecord {
	return {
		candidateManifestDigest: input.digest,
		candidateReleaseId: input.releaseId,
		cloudflareVersionId: input.versionId,
		completedAt: input.startedAt,
		environment: "staging",
		id: input.id,
		startedAt: input.startedAt,
		status: "deployed",
		surface: "public_docs",
		validation: { errors: [], ok: true, warnings: [] },
	};
}

function writeLedger(path: string, records: PublicDocsReleaseLedger["records"]): void {
	writeFileSync(
		path,
		`${JSON.stringify({ records, version: 1 } satisfies PublicDocsReleaseLedger)}\n`,
	);
}

function readLedger(path: string): PublicDocsReleaseLedger {
	return JSON.parse(readFileSync(path, "utf8")) as PublicDocsReleaseLedger;
}

describe("rollback published reader release", () => {
	it("resolves the previous deployed record as the default rollback target", () => {
		const target = resolvePublicDocsRollbackTarget({
			environment: "staging",
			ledger: {
				records: [
					deployedRecord({
						digest: "digest-a",
						id: "deploy-a",
						releaseId: "release-a",
						startedAt: "2026-04-29T09:00:00.000Z",
						versionId: "version-a",
					}),
					deployedRecord({
						digest: "digest-b",
						id: "deploy-b",
						releaseId: "release-b",
						startedAt: "2026-04-29T10:00:00.000Z",
						versionId: "version-b",
					}),
				],
				version: 1,
			},
		});

		expect(target).toMatchObject({
			recordId: "deploy-a",
			releaseId: "release-a",
			versionId: "version-a",
		});
	});

	it("fails closed when the chosen rollback target has no Worker version id", () => {
		expect(() =>
			resolvePublicDocsRollbackTarget({
				environment: "staging",
				ledger: {
					records: [
						deployedRecord({
							digest: "digest-a",
							id: "deploy-a",
							releaseId: "release-a",
							startedAt: "2026-04-29T09:00:00.000Z",
						}),
					],
					version: 1,
				},
				targetReleaseId: "release-a",
			}),
		).toThrow("rollback target requires cloudflareVersionId");
	});

	it("plans rollback without executing Wrangler in dry-run mode", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		writeLedger(ledgerFilePath, [
			deployedRecord({
				digest: "digest-a",
				id: "deploy-a",
				releaseId: "release-a",
				startedAt: "2026-04-29T09:00:00.000Z",
				versionId: "version-a",
			}),
		]);
		const executed: PublicDocsRollbackCommandSpec[] = [];

		const result = await rollbackPublishedReaderRelease({
			commandRunner: async (command) => {
				executed.push(command);
				return { exitCode: 0, stderr: "", stdout: "" };
			},
			dryRun: true,
			environment: "staging",
			ledgerFilePath,
			lockFilePath,
			now: "2026-04-29T12:00:00.000Z",
			reason: "operator drill",
			targetReleaseId: "release-a",
		});

		expect(result.outcome).toBe("dry_run");
		expect(result.plannedCommand.args).toContain("rollback");
		expect(result.plannedCommand.args).toContain("version-a");
		expect(executed).toEqual([]);
		expect(readLedger(ledgerFilePath).records).toHaveLength(1);
	});

	it("executes rollback and appends a rolled_back ledger record", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const lockFilePath = join(directory, "lock.json");
		writeLedger(ledgerFilePath, [
			deployedRecord({
				digest: "digest-a",
				id: "deploy-a",
				releaseId: "release-a",
				startedAt: "2026-04-29T09:00:00.000Z",
				versionId: "version-a",
			}),
			deployedRecord({
				digest: "digest-b",
				id: "deploy-b",
				releaseId: "release-b",
				startedAt: "2026-04-29T10:00:00.000Z",
				versionId: "version-b",
			}),
		]);
		const executed: PublicDocsRollbackCommandSpec[] = [];

		const result = await rollbackPublishedReaderRelease({
			commandRunner: async (command) => {
				expect(existsSync(lockFilePath)).toBe(true);
				executed.push(command);
				return { exitCode: 0, stderr: "", stdout: "Deployment ID: rollback-deploy\n" };
			},
			environment: "staging",
			ledgerFilePath,
			lockFilePath,
			now: "2026-04-29T12:00:00.000Z",
			reason: "bad release",
		});

		expect(result.outcome).toBe("rolled_back");
		expect(executed).toHaveLength(1);
		expect(existsSync(lockFilePath)).toBe(false);
		expect(readLedger(ledgerFilePath).records.at(-1)).toMatchObject({
			rollbackReason: "bad release",
			rollbackTargetRecordId: "deploy-a",
			rollbackTargetReleaseId: "release-a",
			rollbackTargetVersionId: "version-a",
			status: "rolled_back",
		});
	});

	it("accepts pnpm separators in rollback args", () => {
		expect(
			parseRollbackPublishedReaderReleaseArgs([
				"--dry-run",
				"--",
				"--env",
				"staging",
				"--ledger",
				"ledger.json",
				"--lock-file",
				"lock.json",
				"--target-version-id",
				"version-a",
			]),
		).toMatchObject({
			dryRun: true,
			environment: "staging",
			ledgerFilePath: "ledger.json",
			lockFilePath: "lock.json",
			targetVersionId: "version-a",
		});
	});
});
