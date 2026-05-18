import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { smokePublishedReaderBuild } from "../scripts/smoke-published-reader-build";
import { temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-build-smoke-"));
	temporaryDirectories.push(directory);
	return directory;
}

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function writeManifest(path: string): void {
	writeFile(
		path,
		JSON.stringify({
			entries: [
				{
					deliveryMode: "public_static_asset",
					sourceObjects: {},
					targetObjects: {
						"asset-manifest": "_docs/curriculum/curriculum_plan/law/current/asset-manifest.json",
						reader: "_docs/curriculum/curriculum_plan/law/current/reader.json",
					},
				},
				{
					deliveryMode: "gated_asset",
					sourceObjects: {},
					targetObjects: {
						"asset-manifest":
							"_gated-docs/regulations/student_rules/secret/current/asset-manifest.json",
					},
				},
			],
			surface: "public_docs",
		}),
	);
}

describe("published reader build smoke", () => {
	it("passes when the built site and manifest target assets exist", () => {
		const directory = createTempDir();
		const buildDir = resolve(directory, "doc_build");
		const manifestPath = resolve(directory, "manifest.json");
		writeFile(resolve(buildDir, "index.html"), "<!doctype html>");
		writeFile(
			resolve(buildDir, "_docs/curriculum/curriculum_plan/law/current/asset-manifest.json"),
			"{}",
		);
		writeFile(resolve(buildDir, "_docs/curriculum/curriculum_plan/law/current/reader.json"), "{}");
		writeFile(
			resolve(buildDir, "_gated-docs/regulations/student_rules/secret/current/asset-manifest.json"),
			"{}",
		);
		writeManifest(manifestPath);

		expect(
			smokePublishedReaderBuild({
				buildDir,
				manifestFilePath: manifestPath,
			}),
		).toMatchObject({
			ok: true,
			checkedAssetCount: 3,
		});
	});

	it("fails closed when a manifest target asset is missing from the build output", () => {
		const directory = createTempDir();
		const buildDir = resolve(directory, "doc_build");
		const manifestPath = resolve(directory, "manifest.json");
		writeFile(resolve(buildDir, "index.html"), "<!doctype html>");
		writeManifest(manifestPath);

		expect(() =>
			smokePublishedReaderBuild({
				buildDir,
				manifestFilePath: manifestPath,
			}),
		).toThrow(
			/pnpm --filter public-docs (build:published-reader-assets|sync:published-reader-assets)/,
		);
	});

	it("discovers the standard local sync manifest when no manifest is passed", () => {
		vi.stubEnv("CLOUDFLARE_ENV", "");
		vi.stubEnv("PUBLIC_DOCS_SYNC_MANIFEST_PATH", "");
		const directory = createTempDir();
		const buildDir = resolve(directory, "doc_build");
		const manifestPath = resolve(directory, "var/public-docs-sync-manifest.json");
		writeFile(resolve(buildDir, "index.html"), "<!doctype html>");
		writeFile(
			resolve(buildDir, "_docs/curriculum/curriculum_plan/law/current/asset-manifest.json"),
			"{}",
		);
		writeFile(resolve(buildDir, "_docs/curriculum/curriculum_plan/law/current/reader.json"), "{}");
		writeFile(
			resolve(buildDir, "_gated-docs/regulations/student_rules/secret/current/asset-manifest.json"),
			"{}",
		);
		writeManifest(manifestPath);

		expect(
			smokePublishedReaderBuild({
				buildDir,
				repoRoot: directory,
			}),
		).toMatchObject({
			ok: true,
			checkedAssetCount: 3,
			manifestFilePath: manifestPath,
		});
	});

	it("fails closed instead of using a staging manifest for local build smoke", () => {
		vi.stubEnv("CLOUDFLARE_ENV", "");
		vi.stubEnv("PUBLIC_DOCS_SYNC_MANIFEST_PATH", "");
		const directory = createTempDir();
		const buildDir = resolve(directory, "doc_build");
		const stagingManifestPath = resolve(directory, "var/public-docs-sync-manifest.staging.json");
		writeFile(resolve(buildDir, "index.html"), "<!doctype html>");
		writeManifest(stagingManifestPath);

		expect(() =>
			smokePublishedReaderBuild({
				buildDir,
				repoRoot: directory,
			}),
		).toThrow(/published reader build smoke manifest is missing/);
	});
});
