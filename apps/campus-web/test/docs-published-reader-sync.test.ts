import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	syncCampusPublishedReaderAssets,
	syncCampusPublishedReaderDocs,
} from "../scripts/sync-campus-published-reader.mjs";

interface ObjectStoreClient {
	readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined>;
	readTextObject(input: { key: string }): Promise<string>;
}

let tempDir: string | null = null;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { force: true, recursive: true });
		tempDir = null;
	}
});

describe("campus-web published reader sync", () => {
	it("generates Rspress MDX reader pages with stable rootUnitId anchors", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture();
		const docsRoot = join(root, "docs");

		const result = await syncCampusPublishedReaderDocs({
			client,
			docsRoot,
			manifestFilePath: manifestPath,
		});

		expect(result.generatedDocumentCount).toBe(1);
		const currentMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/student-attendance.mdx"),
			"utf8",
		);
		const versionMdx = readFileSync(
			join(docsRoot, "docs/regulations/student_rules/student-attendance/v/2026-current.mdx"),
			"utf8",
		);

		expect(currentMdx).toContain('data-root-unit-id="attendance-root"');
		expect(currentMdx).toContain('<span id="general"></span>');
		expect(currentMdx).toContain("学生应按时参加教学活动。");
		expect(versionMdx).toContain('data-docs-version-slug="2026-current"');
	});

	it("copies published reader assets into campus-web static delivery roots", async () => {
		const { client, manifestPath, root } = createPublishedReaderFixture();
		const targetRoot = join(root, "public");

		const result = await syncCampusPublishedReaderAssets({
			client,
			manifestFilePath: manifestPath,
			targetRoot,
		});

		expect(result).toMatchObject({
			copiedDocumentCount: 2,
			copiedGatedDocumentCount: 1,
			copiedPublicDocumentCount: 1,
		});
		expect(
			readFileSync(
				join(
					targetRoot,
					"_docs/regulations/student_rules/student-attendance/2026-current/reader.json",
				),
				"utf8",
			),
		).toContain("attendance-root");
		expect(
			readFileSync(
				join(
					targetRoot,
					"_gated-docs/regulations/student_rules/restricted-policy/2026-current/reader.json",
				),
				"utf8",
			),
		).toContain("restricted-root");
	});
});

function createPublishedReaderFixture(): {
	client: ObjectStoreClient;
	manifestPath: string;
	root: string;
} {
	tempDir = mkdtempSync(join(tmpdir(), "campus-docs-sync-"));
	const root = tempDir;
	const publicReader = JSON.stringify({
		document: { title: "学生考勤管理规定" },
		sections: [
			{
				anchor: "general",
				blocks: [
					{
						kind: "paragraph",
						rootUnitId: "attendance-root",
						text: "学生应按时参加教学活动。",
					},
				],
				title: "总则",
			},
		],
	});
	const gatedReader = JSON.stringify({
		document: { title: "受限制度" },
		sections: [
			{
				anchor: "restricted",
				blocks: [
					{
						kind: "paragraph",
						rootUnitId: "restricted-root",
						text: "这是一条受限正文。",
					},
				],
				title: "受限章节",
			},
		],
	});
	const publicOutline = "{}";
	const publicMeta = JSON.stringify({ sourceLabel: "学生手册" });
	const gatedOutline = "{}";
	const gatedMeta = JSON.stringify({ sourceLabel: "受限制度" });
	const objects = new Map<string, string>([
		["reader/public.json", publicReader],
		["outline/public.json", publicOutline],
		["meta/public.json", publicMeta],
		[
			"manifest/public.json",
			buildAssetManifest({ meta: publicMeta, outline: publicOutline, reader: publicReader }),
		],
		["reader/gated.json", gatedReader],
		["outline/gated.json", gatedOutline],
		["meta/gated.json", gatedMeta],
		[
			"manifest/gated.json",
			buildAssetManifest({ meta: gatedMeta, outline: gatedOutline, reader: gatedReader }),
		],
	]);
	const manifest = {
		entries: [
			{
				collection: "student_rules",
				corpus: "regulations",
				deliveryMode: "public_static_asset",
				docId: "doc_public",
				documentSlug: "student-attendance",
				isCurrent: true,
				sourceObjects: {
					"asset-manifest": "manifest/public.json",
					meta: "meta/public.json",
					outline: "outline/public.json",
					reader: "reader/public.json",
				},
				targetObjects: {
					"asset-manifest":
						"_docs/regulations/student_rules/student-attendance/2026-current/asset-manifest.json",
					meta: "_docs/regulations/student_rules/student-attendance/2026-current/meta.json",
					outline: "_docs/regulations/student_rules/student-attendance/2026-current/outline.json",
					reader: "_docs/regulations/student_rules/student-attendance/2026-current/reader.json",
				},
				title: "学生考勤管理规定",
				versionId: "version_public",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
			{
				collection: "student_rules",
				corpus: "regulations",
				deliveryMode: "gated_asset",
				docId: "doc_gated",
				documentSlug: "restricted-policy",
				isCurrent: true,
				sourceObjects: {
					"asset-manifest": "manifest/gated.json",
					meta: "meta/gated.json",
					outline: "outline/gated.json",
					reader: "reader/gated.json",
				},
				targetObjects: {
					"asset-manifest":
						"_docs/regulations/student_rules/restricted-policy/2026-current/asset-manifest.json",
					meta: "_docs/regulations/student_rules/restricted-policy/2026-current/meta.json",
					outline: "_docs/regulations/student_rules/restricted-policy/2026-current/outline.json",
					reader: "_docs/regulations/student_rules/restricted-policy/2026-current/reader.json",
				},
				title: "受限制度",
				versionId: "version_gated",
				versionLabel: "现行版",
				versionSlug: "2026-current",
			},
		],
		surface: "public_docs",
	};
	const manifestPath = join(root, "manifest.json");
	writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
	return {
		client: {
			async readOptionalBytesObject(input) {
				const value = objects.get(input.key);
				return value ? new TextEncoder().encode(value) : undefined;
			},
			async readTextObject(input) {
				const value = objects.get(input.key);
				if (!value) {
					throw new Error(`missing object: ${input.key}`);
				}
				return value;
			},
		},
		manifestPath,
		root,
	};
}

function buildAssetManifest(input: { meta: string; outline: string; reader: string }): string {
	return JSON.stringify({
		files: {
			"meta.json": {
				sha256: sha256(input.meta),
				sizeBytes: new TextEncoder().encode(input.meta).byteLength,
			},
			"outline.json": {
				sha256: sha256(input.outline),
				sizeBytes: new TextEncoder().encode(input.outline).byteLength,
			},
			"reader.json": {
				sha256: sha256(input.reader),
				sizeBytes: new TextEncoder().encode(input.reader).byteLength,
			},
		},
	});
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
