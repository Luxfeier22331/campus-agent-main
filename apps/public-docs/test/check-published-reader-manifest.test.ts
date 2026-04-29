import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	appendPublicDocsReleaseLedgerRecord,
	checkPublishedReaderManifest,
	type PublicDocsReleaseLedger,
	type PublicDocsReleaseLedgerRecord,
	parsePublishedReaderManifestCheckArgs,
} from "../scripts/check-published-reader-manifest";
import { FakeObjectStore, temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-manifest-check-"));
	temporaryDirectories.push(directory);
	return directory;
}

function sha256Hex(content: string | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

function assetManifest(files: Record<string, string>): string {
	return JSON.stringify({
		files: Object.fromEntries(
			Object.entries(files).map(([name, content]) => [
				name,
				{
					sha256: sha256Hex(content),
					sizeBytes: new TextEncoder().encode(content).byteLength,
				},
			]),
		),
	});
}

function validManifest(): string {
	return JSON.stringify({
		entries: [
			{
				collection: "curriculum_plan",
				corpus: "curriculum",
				deliveryMode: "public_static_asset",
				docId: "curriculum:law",
				documentSlug: "law",
				isCurrent: true,
				sourceObjects: {
					manifest: "reader-assets/law/asset-manifest.json",
					reader: "reader-assets/law/reader.json",
				},
				targetObjects: {
					"asset-manifest": "_docs/curriculum/curriculum_plan/law/2026-current/asset-manifest.json",
					reader: "_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
				},
				title: "法学本科人才培养方案",
				versionId: "ver_law",
				versionSlug: "2026-current",
			},
		],
		generatedAt: "2026-04-29T10:00:00.000Z",
		surface: "public_docs",
	});
}

function objectStoreWithManifest(manifest: string): FakeObjectStore {
	return new FakeObjectStore(
		new Map([
			["manifests/current-public-docs.json", manifest],
			["reader-assets/law/reader.json", '{"sections":[]}'],
			[
				"reader-assets/law/asset-manifest.json",
				assetManifest({ "reader.json": '{"sections":[]}' }),
			],
		]),
	);
}

function deployedRecord(input: {
	environment: "prod" | "staging";
	manifestDigest: string;
	releaseId?: string;
}): PublicDocsReleaseLedgerRecord {
	return {
		candidateManifestDigest: input.manifestDigest,
		candidateReleaseId: input.releaseId ?? "release-current",
		completedAt: "2026-04-29T10:10:00.000Z",
		environment: input.environment,
		id: "record-1",
		startedAt: "2026-04-29T10:00:00.000Z",
		status: "deployed",
		surface: "public_docs",
		validation: { errors: [], ok: true, warnings: [] },
	};
}

describe("published reader manifest check", () => {
	it("returns changed when the current manifest digest has not been deployed", async () => {
		const manifest = validManifest();
		const result = await checkPublishedReaderManifest({
			client: objectStoreWithManifest(manifest),
			environment: "prod",
			manifestObjectKey: "manifests/current-public-docs.json",
			now: "2026-04-29T11:00:00.000Z",
			runnerId: "test-runner",
		});

		expect(result.verdict).toBe("changed");
		expect(result.candidateManifestDigest).toBe(sha256Hex(manifest));
		expect(result.candidateReleaseId).toBe("2026-04-29T10:00:00.000Z");
		expect(result.validation).toEqual({ errors: [], ok: true, warnings: [] });
		expect(result.summary).toMatchObject({
			gatedEntryCount: 0,
			publicEntryCount: 1,
			totalEntryCount: 1,
		});
		expect(result.ledgerRecord).toMatchObject({
			candidateManifestDigest: sha256Hex(manifest),
			candidateReleaseId: "2026-04-29T10:00:00.000Z",
			environment: "prod",
			runnerId: "test-runner",
			status: "validating",
			surface: "public_docs",
		});
	});

	it("returns unchanged with a skipped candidate when the digest already deployed", async () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");
		const manifest = validManifest();
		const digest = sha256Hex(manifest);
		writeFileSync(
			ledgerFilePath,
			JSON.stringify({
				records: [deployedRecord({ environment: "prod", manifestDigest: digest })],
				version: 1,
			} satisfies PublicDocsReleaseLedger),
		);

		const result = await checkPublishedReaderManifest({
			client: objectStoreWithManifest(manifest),
			environment: "prod",
			ledgerFilePath,
			manifestObjectKey: "manifests/current-public-docs.json",
			now: "2026-04-29T11:00:00.000Z",
		});

		expect(result.verdict).toBe("unchanged");
		expect(result.previousManifestDigest).toBe(digest);
		expect(result.ledgerRecord.status).toBe("skipped");
		expect(JSON.parse(readFileSync(ledgerFilePath, "utf8"))).toEqual({
			records: [deployedRecord({ environment: "prod", manifestDigest: digest })],
			version: 1,
		});
	});

	it("returns invalid for malformed manifest JSON without advancing deployed state", async () => {
		const result = await checkPublishedReaderManifest({
			client: new FakeObjectStore(new Map([["manifest.json", '{"entries":']])),
			environment: "staging",
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T11:00:00.000Z",
		});

		expect(result.verdict).toBe("invalid");
		expect(result.validation.ok).toBe(false);
		expect(result.validation.errors.join("\n")).toContain("manifest JSON is invalid");
		expect(result.ledgerRecord.status).toBe("failed");
	});

	it("blocks gated reader assets that declare public static targets", async () => {
		const manifest = JSON.stringify({
			entries: [
				{
					deliveryMode: "gated_asset",
					docId: "restricted:secret",
					sourceObjects: {
						manifest: "reader-assets/secret/asset-manifest.json",
						reader: "reader-assets/secret/reader.json",
					},
					targetObjects: {
						"asset-manifest": "_docs/restricted/secret/current/asset-manifest.json",
						reader: "_docs/restricted/secret/current/reader.json",
					},
				},
			],
			generatedAt: "2026-04-29T10:00:00.000Z",
			surface: "public_docs",
		});

		const result = await checkPublishedReaderManifest({
			client: new FakeObjectStore(new Map([["manifest.json", manifest]])),
			environment: "prod",
			manifestObjectKey: "manifest.json",
			now: "2026-04-29T11:00:00.000Z",
		});

		expect(result.verdict).toBe("blocked");
		expect(result.validation.ok).toBe(false);
		expect(result.validation.errors.join("\n")).toContain(
			"gated reader asset target must stay under _gated-docs/",
		);
		expect(result.ledgerRecord.status).toBe("failed");
	});

	it("rejects deployed ledger records without successful validation", () => {
		const directory = createTempDir();
		const ledgerFilePath = join(directory, "ledger.json");

		expect(() =>
			appendPublicDocsReleaseLedgerRecord({
				ledgerFilePath,
				record: {
					candidateManifestDigest: "digest",
					candidateReleaseId: "release",
					completedAt: "2026-04-29T11:05:00.000Z",
					environment: "prod",
					id: "record-1",
					startedAt: "2026-04-29T11:00:00.000Z",
					status: "deployed",
					surface: "public_docs",
					validation: { errors: ["still invalid"], ok: false, warnings: [] },
				},
			}),
		).toThrow("deployed release ledger record requires successful validation");
	});

	it("accepts pnpm script argument separators for operator-provided flags", () => {
		expect(
			parsePublishedReaderManifestCheckArgs([
				"--dry-run",
				"--",
				"--env",
				"staging",
				"--ledger",
				"ledger.json",
			]),
		).toMatchObject({
			environment: "staging",
			ledgerFilePath: "ledger.json",
			writeLedger: false,
		});
	});
});
