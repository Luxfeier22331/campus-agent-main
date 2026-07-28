// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	DEFAULT_STAGING_DOCS_BASE_URL,
	DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL,
	DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL,
	parseStagingDocsGatedSmokeArgs,
	resolveStagingDocsGatedSmokeTargets,
} from "../e2e/support/staging-docs-gated-smoke.args";

describe("staging docs gated smoke args", () => {
	it("uses canonical staging endpoints without guessing a gated target", () => {
		expect(
			parseStagingDocsGatedSmokeArgs([], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toEqual({
			appApiReadyzUrl: DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL,
			chatBaseUrl: DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL,
			docsBaseUrl: DEFAULT_STAGING_DOCS_BASE_URL,
			email: "campus_agent_smoke@muc.edu.cn",
			gatedCollectionNavigationPath: null,
			gatedCollectionNavigationUnauthenticatedStatus: 404,
			gatedReaderPath: null,
			name: "Campus Agent Smoke",
			smokeAuthSecret: "smoke-secret",
		});
	});

	it("requires explicit targets from the selected release", () => {
		expect(() =>
			resolveStagingDocsGatedSmokeTargets(
				parseStagingDocsGatedSmokeArgs([], {
					APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
				} as NodeJS.ProcessEnv),
			),
		).toThrow("requires explicit collection navigation and reader paths");
	});

	it("accepts explicit staging targets and navigation visibility", () => {
		const parsed = parseStagingDocsGatedSmokeArgs(
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
				"--gated-collection-navigation-unauthenticated-status",
				"200",
				"--gated-reader-path",
				"_gated-docs/corpus/collection/doc/version/reader.json",
				"--smoke-auth-secret",
				"explicit-smoke-secret",
			],
			{} as NodeJS.ProcessEnv,
		);

		expect(resolveStagingDocsGatedSmokeTargets(parsed)).toEqual({
			appApiReadyzUrl: "https://api.example.com/readyz",
			chatBaseUrl: "https://campus.example.com",
			docsBaseUrl: "https://docs.example.com",
			email: "smoke-user@example.edu",
			gatedCollectionNavigationPath: "/api/docs/collections/regulations/scoped_rules/navigation",
			gatedCollectionNavigationUnauthenticatedStatus: 200,
			gatedReaderPath: "/_gated-docs/corpus/collection/doc/version/reader.json",
			name: "Smoke User",
			smokeAuthSecret: "explicit-smoke-secret",
		});
	});

	it("rejects invalid navigation status and missing authentication", () => {
		expect(() =>
			parseStagingDocsGatedSmokeArgs(
				["--gated-collection-navigation-unauthenticated-status", "500"],
				{ APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret" } as NodeJS.ProcessEnv,
			),
		).toThrow("must be 200 or 404");
		expect(() => parseStagingDocsGatedSmokeArgs([], {} as NodeJS.ProcessEnv)).toThrow(
			"APP_API_STAGING_SMOKE_AUTH_SECRET",
		);
	});
});
