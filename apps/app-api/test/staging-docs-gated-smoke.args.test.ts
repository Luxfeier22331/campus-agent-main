// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	DEFAULT_STAGING_DOCS_BASE_URL,
	DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL,
	DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL,
	parseStagingDocsGatedSmokeArgs,
	resolveStagingDocsGatedSmokeTargets,
} from "../e2e/support/staging-docs-gated-smoke.args";

const E2E_CREDENTIAL_ARGS = [
	"--email",
	"smoke-user@example.edu",
	"--password",
	"dev-smoke-password",
	"--captcha-token",
	"dev-captcha-token",
];

describe("staging docs gated smoke args", () => {
	it("uses canonical staging endpoints without guessing a gated target", () => {
		expect(parseStagingDocsGatedSmokeArgs(E2E_CREDENTIAL_ARGS)).toEqual({
			appApiReadyzUrl: DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL,
			captchaToken: "dev-captcha-token",
			chatBaseUrl: DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL,
			docsBaseUrl: DEFAULT_STAGING_DOCS_BASE_URL,
			email: "smoke-user@example.edu",
			gatedCollectionNavigationPath: null,
			gatedCollectionNavigationUnauthenticatedStatus: 404,
			gatedReaderPath: null,
			password: "dev-smoke-password",
		});
	});

	it("requires explicit targets from the selected release", () => {
		expect(() =>
			resolveStagingDocsGatedSmokeTargets(parseStagingDocsGatedSmokeArgs(E2E_CREDENTIAL_ARGS)),
		).toThrow("requires explicit collection navigation and reader paths");
	});

	it("accepts explicit staging targets and navigation visibility", () => {
		const parsed = parseStagingDocsGatedSmokeArgs([
			"--",
			"--email",
			"smoke-user@example.edu",
			"--password",
			"dev-smoke-password",
			"--captcha-token",
			"dev-captcha-token",
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
		]);

		expect(resolveStagingDocsGatedSmokeTargets(parsed)).toEqual({
			appApiReadyzUrl: "https://api.example.com/readyz",
			captchaToken: "dev-captcha-token",
			chatBaseUrl: "https://campus.example.com",
			docsBaseUrl: "https://docs.example.com",
			email: "smoke-user@example.edu",
			gatedCollectionNavigationPath: "/api/docs/collections/regulations/scoped_rules/navigation",
			gatedCollectionNavigationUnauthenticatedStatus: 200,
			gatedReaderPath: "/_gated-docs/corpus/collection/doc/version/reader.json",
			password: "dev-smoke-password",
		});
	});

	it("rejects invalid navigation status and missing authentication", () => {
		expect(() =>
			parseStagingDocsGatedSmokeArgs([
				"--gated-collection-navigation-unauthenticated-status",
				"500",
				...E2E_CREDENTIAL_ARGS,
			]),
		).toThrow("must be 200 or 404");
		expect(() => parseStagingDocsGatedSmokeArgs([])).toThrow("--email is required.");
	});
});
