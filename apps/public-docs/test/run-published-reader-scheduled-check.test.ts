import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PublicDocsReleaseLedger } from "../scripts/check-published-reader-manifest";
import {
	type PublicDocsPublishLockFile,
	parsePublishedReaderScheduledCheckArgs,
	resolvePublicDocsPublishScheduleWindow,
	runPublishedReaderScheduledCheck,
} from "../scripts/run-published-reader-scheduled-check";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-scheduled-check-"));
	temporaryDirectories.push(directory);
	return directory;
}

function manifest(): string {
	return JSON.stringify({
		entries: [],
		generatedAt: "2026-04-29T10:00:00.000Z",
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

function writeActiveLock(path: string, lock: PublicDocsPublishLockFile): void {
	writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
}

describe("published reader scheduled check", () => {
	it("resolves accepted Shanghai publish windows from UTC time", () => {
		expect(
			resolvePublicDocsPublishScheduleWindow({
				dueWindowMinutes: 10,
				now: "2026-04-29T21:59:00.000Z",
			}),
		).toMatchObject({
			cronUtc: "7 4,10,16,22 * * *",
			due: false,
		});

		expect(
			resolvePublicDocsPublishScheduleWindow({
				dueWindowMinutes: 10,
				now: "2026-04-29T22:05:00.000Z",
			}),
		).toMatchObject({
			cronUtc: "7 4,10,16,22 * * *",
			due: true,
			scheduleKey: "2026-04-30T06:00:00+08:00",
			shanghaiTime: "2026-04-30T06:05:00+08:00",
			windowLabel: "06:00",
		});
	});

	it("returns not_due outside the accepted schedule without touching lock or ledger", async () => {
		const directory = createTempDir();
		const lockFilePath = join(directory, "lock.json");
		const ledgerFilePath = join(directory, "ledger.json");

		const result = await runPublishedReaderScheduledCheck({
			client: objectStoreWithManifest(manifest()),
			dueWindowMinutes: 10,
			environment: "staging",
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T21:45:00.000Z",
			runnerId: "runner-a",
		});

		expect(result.outcome).toBe("not_due");
		expect(existsSync(lockFilePath)).toBe(false);
		expect(existsSync(ledgerFilePath)).toBe(false);
	});

	it("acquires the lock, checks the manifest, appends ledger, and releases the lock", async () => {
		const directory = createTempDir();
		const lockFilePath = join(directory, "lock.json");
		const ledgerFilePath = join(directory, "ledger.json");

		const result = await runPublishedReaderScheduledCheck({
			client: objectStoreWithManifest(manifest()),
			dueWindowMinutes: 10,
			environment: "prod",
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
			runnerId: "runner-a",
		});

		expect(result.outcome).toBe("checked");
		expect(result.check?.verdict).toBe("changed");
		expect(existsSync(lockFilePath)).toBe(false);
		const ledger = readLedger(ledgerFilePath);
		expect(ledger.records).toHaveLength(1);
		expect(ledger.records[0]).toMatchObject({
			environment: "prod",
			lockId: result.lockId,
			runnerId: "runner-a",
			scheduleKey: "2026-04-30T06:00:00+08:00",
			status: "validating",
			trigger: "scheduled",
		});
	});

	it("appends a skipped ledger record when the manifest digest is already deployed", async () => {
		const directory = createTempDir();
		const lockFilePath = join(directory, "lock.json");
		const ledgerFilePath = join(directory, "ledger.json");
		const manifestContent = manifest();
		const digest = sha256Hex(manifestContent);
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

		const result = await runPublishedReaderScheduledCheck({
			client: objectStoreWithManifest(manifestContent),
			dueWindowMinutes: 10,
			environment: "prod",
			ledgerFilePath,
			lockFilePath,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
			runnerId: "runner-a",
		});

		expect(result.outcome).toBe("checked");
		expect(result.check?.verdict).toBe("unchanged");
		const ledger = readLedger(ledgerFilePath);
		expect(ledger.records).toHaveLength(2);
		expect(ledger.records[1]).toMatchObject({
			candidateManifestDigest: digest,
			status: "skipped",
			trigger: "scheduled",
		});
	});

	it("returns lock_busy when another non-stale runner holds the lock", async () => {
		const directory = createTempDir();
		const lockFilePath = join(directory, "lock.json");
		const ledgerFilePath = join(directory, "ledger.json");
		writeActiveLock(lockFilePath, {
			acquiredAt: "2026-04-29T21:55:00.000Z",
			expiresAt: "2026-04-29T22:55:00.000Z",
			lockId: "active-lock",
			ownerId: "other-runner",
			schemaVersion: 1,
		});

		const result = await runPublishedReaderScheduledCheck({
			client: objectStoreWithManifest(manifest()),
			dueWindowMinutes: 10,
			environment: "prod",
			ledgerFilePath,
			lockFilePath,
			lockStaleMs: 60 * 60 * 1000,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
			runnerId: "runner-a",
		});

		expect(result).toMatchObject({
			activeLock: { lockId: "active-lock", ownerId: "other-runner" },
			outcome: "lock_busy",
		});
		expect(readFileSync(lockFilePath, "utf8")).toContain("active-lock");
		expect(existsSync(ledgerFilePath)).toBe(false);
	});

	it("removes a stale lock before running the scheduled check", async () => {
		const directory = createTempDir();
		const lockFilePath = join(directory, "lock.json");
		const ledgerFilePath = join(directory, "ledger.json");
		writeActiveLock(lockFilePath, {
			acquiredAt: "2026-04-29T19:00:00.000Z",
			expiresAt: "2026-04-29T20:00:00.000Z",
			lockId: "stale-lock",
			ownerId: "crashed-runner",
			schemaVersion: 1,
		});

		const result = await runPublishedReaderScheduledCheck({
			client: objectStoreWithManifest(manifest()),
			dueWindowMinutes: 10,
			environment: "prod",
			ledgerFilePath,
			lockFilePath,
			lockStaleMs: 60 * 60 * 1000,
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T22:00:00.000Z",
			runnerId: "runner-a",
		});

		expect(result.outcome).toBe("checked");
		expect(result.staleLockRemoved).toBe(true);
		expect(existsSync(lockFilePath)).toBe(false);
		expect(readLedger(ledgerFilePath).records).toHaveLength(1);
	});

	it("accepts pnpm script separators in scheduled runner args", () => {
		expect(
			parsePublishedReaderScheduledCheckArgs([
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
			environment: "staging",
			force: true,
			ledgerFilePath: "ledger.json",
			lockFilePath: "lock.json",
		});
	});
});
