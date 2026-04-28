// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	DEFAULT_STAGING_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_BASE_URL,
} from "../scripts/staging-chat-smoke.args";
import {
	DEFAULT_STAGING_DOCS_BASE_URL,
	DEFAULT_STAGING_GATED_COLLECTION_NAVIGATION_PATH,
	DEFAULT_STAGING_GATED_READER_PATH,
	parseStagingDocsGatedSmokeArgs,
} from "../scripts/staging-docs-gated-smoke.args";

describe("staging docs gated smoke args", () => {
	it("uses canonical staging defaults", () => {
		expect(
			parseStagingDocsGatedSmokeArgs([], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toEqual({
			appApiReadyzUrl: DEFAULT_STAGING_APP_API_READYZ_URL,
			chatBaseUrl: DEFAULT_STAGING_CHAT_BASE_URL,
			docsBaseUrl: DEFAULT_STAGING_DOCS_BASE_URL,
			gatedCollectionNavigationPath: DEFAULT_STAGING_GATED_COLLECTION_NAVIGATION_PATH,
			email: "help_bot@outlook.com",
			gatedReaderPath: DEFAULT_STAGING_GATED_READER_PATH,
			name: "Campus Agent Smoke",
			smokeAuthSecret: "smoke-secret",
		});
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
					"https://chat.example.com",
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
			chatBaseUrl: "https://chat.example.com",
			docsBaseUrl: "https://docs.example.com",
			email: "smoke-user@example.edu",
			gatedCollectionNavigationPath:
				"/api/docs/collections/regulations/scoped_rules/navigation",
			gatedReaderPath: "/_gated-docs/corpus/collection/doc/version/reader.json",
			name: "Smoke User",
			smokeAuthSecret: "explicit-smoke-secret",
		});
	});

	it("fails closed when no smoke auth secret is available", () => {
		expect(() => parseStagingDocsGatedSmokeArgs([], {} as NodeJS.ProcessEnv)).toThrow(
			"APP_API_STAGING_SMOKE_AUTH_SECRET",
		);
	});
});
