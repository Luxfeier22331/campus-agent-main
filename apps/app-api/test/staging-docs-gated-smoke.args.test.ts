// @vitest-environment node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_STAGING_DOCS_BASE_URL,
	DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL,
	DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL,
	parseStagingDocsGatedSmokeArgs,
	resolveStagingDocsGatedSmokeTargets,
} from "../scripts/staging-docs-gated-smoke.args";

describe("staging docs gated smoke args", () => {
	it("uses canonical staging defaults and defers gated targets to the sync manifest", () => {
		expect(
			parseStagingDocsGatedSmokeArgs([], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toEqual({
			appApiReadyzUrl: DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL,
			chatBaseUrl: DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL,
			docsBaseUrl: DEFAULT_STAGING_DOCS_BASE_URL,
			gatedCollectionNavigationPath: null,
			gatedCollectionNavigationUnauthenticatedStatus: 404,
			email: "help_bot@outlook.com",
			gatedReaderPath: null,
			name: "Campus Agent Smoke",
			publicDocsSyncManifestPath: expect.stringContaining(
				"var/public-docs-sync-manifest.staging.json",
			),
			smokeAuthSecret: "smoke-secret",
		});
	});

	it("selects a gated reader from the public docs sync manifest and treats mixed collection navigation as public", () => {
		const manifestPath = writeManifest({
			entries: [
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "public_static_asset",
					documentSlug: "public-doc",
					targetObjects: {
						reader: "_docs/curriculum/curriculum_plan/public-doc/current/reader.json",
					},
					versionSlug: "current",
				},
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "gated_asset",
					documentSlug: "restricted-doc",
					targetObjects: {
						reader:
							"_gated-docs/curriculum/curriculum_plan/restricted-doc/2022-current/reader.json",
					},
					versionSlug: "2022-current",
				},
			],
		});

		const targets = resolveStagingDocsGatedSmokeTargets(
			parseStagingDocsGatedSmokeArgs([], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
				PUBLIC_DOCS_SYNC_MANIFEST_PATH: manifestPath,
			} as NodeJS.ProcessEnv),
		);

		expect(targets.gatedReaderPath).toBe(
			"/_gated-docs/curriculum/curriculum_plan/restricted-doc/2022-current/reader.json",
		);
		expect(targets.gatedCollectionNavigationPath).toBe(
			"/api/docs/collections/curriculum/curriculum_plan/navigation",
		);
		expect(targets.gatedCollectionNavigationUnauthenticatedStatus).toBe(200);
	});

	it("keeps gated-only collection navigation closed for anonymous users", () => {
		const manifestPath = writeManifest({
			entries: [
				{
					collection: "scoped_rules",
					corpus: "regulations",
					deliveryMode: "gated_asset",
					documentSlug: "restricted-doc",
					targetObjects: {
						reader: "_gated-docs/regulations/scoped_rules/restricted-doc/current/reader.json",
					},
					versionSlug: "current",
				},
			],
		});

		const targets = resolveStagingDocsGatedSmokeTargets(
			parseStagingDocsGatedSmokeArgs([], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
				PUBLIC_DOCS_SYNC_MANIFEST_PATH: manifestPath,
			} as NodeJS.ProcessEnv),
		);

		expect(targets.gatedCollectionNavigationPath).toBe(
			"/api/docs/collections/regulations/scoped_rules/navigation",
		);
		expect(targets.gatedCollectionNavigationUnauthenticatedStatus).toBe(404);
	});

	it("fails clearly when the public docs sync manifest has no gated reader entry", () => {
		const manifestPath = writeManifest({
			entries: [
				{
					collection: "student_rules",
					corpus: "regulations",
					deliveryMode: "public_static_asset",
					documentSlug: "public-doc",
					targetObjects: {
						reader: "_docs/regulations/student_rules/public-doc/current/reader.json",
					},
					versionSlug: "current",
				},
			],
		});

		expect(() =>
			resolveStagingDocsGatedSmokeTargets(
				parseStagingDocsGatedSmokeArgs([], {
					APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
					PUBLIC_DOCS_SYNC_MANIFEST_PATH: manifestPath,
				} as NodeJS.ProcessEnv),
			),
		).toThrow("must contain at least one gated_asset entry");
	});

	it("accepts explicit staging overrides", () => {
		expect(
			parseStagingDocsGatedSmokeArgs(
				[
					"--",
					"--email",
					"smoke-user@example.edu",
					"--name",
					"Smoke User",
					"--chat-base-url",
					"https://campus.example.com",
					"--app-api-readyz-url",
					"https://api.example.com/readyz",
					"--docs-base-url",
					"https://docs.example.com",
					"--gated-collection-navigation-path",
					"api/docs/collections/regulations/scoped_rules/navigation",
					"--gated-reader-path",
					"_gated-docs/corpus/collection/doc/version/reader.json",
					"--smoke-auth-secret",
					"explicit-smoke-secret",
				],
				{} as NodeJS.ProcessEnv,
			),
		).toEqual({
			appApiReadyzUrl: "https://api.example.com/readyz",
			chatBaseUrl: "https://campus.example.com",
			docsBaseUrl: "https://docs.example.com",
			email: "smoke-user@example.edu",
			gatedCollectionNavigationPath: "/api/docs/collections/regulations/scoped_rules/navigation",
			gatedCollectionNavigationUnauthenticatedStatus: 404,
			gatedReaderPath: "/_gated-docs/corpus/collection/doc/version/reader.json",
			name: "Smoke User",
			publicDocsSyncManifestPath: expect.stringContaining(
				"var/public-docs-sync-manifest.staging.json",
			),
			smokeAuthSecret: "explicit-smoke-secret",
		});
	});

	it("fails closed when no smoke auth secret is available", () => {
		expect(() => parseStagingDocsGatedSmokeArgs([], {} as NodeJS.ProcessEnv)).toThrow(
			"APP_API_STAGING_SMOKE_AUTH_SECRET",
		);
	});
});

function writeManifest(manifest: unknown): string {
	const directory = mkdtempSync(join(tmpdir(), "staging-docs-gated-smoke-"));
	const path = join(directory, "public-docs-sync-manifest.json");
	writeFileSync(path, `${JSON.stringify(manifest)}\n`, "utf8");
	return path;
}
