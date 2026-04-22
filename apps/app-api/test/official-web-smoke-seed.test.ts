// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildLocalOfficialWebSmokeSeedRuntime,
	parseOfficialWebSmokeSeedArgs,
} from "../scripts/seed-official-web-smoke";

describe("official web smoke seed helper", () => {
	it("parses the optional site id", () => {
		expect(parseOfficialWebSmokeSeedArgs([])).toEqual({
			siteId: "www_muc_edu_cn",
		});
		expect(parseOfficialWebSmokeSeedArgs(["--", "--site-id", "muc_public"])).toEqual({
			siteId: "muc_public",
		});
		expect(parseOfficialWebSmokeSeedArgs(["--site-id", "muc_public"])).toEqual({
			siteId: "muc_public",
		});
	});

	it("maps local env into a minimal app-api runtime for smoke seeding", () => {
		expect(
			buildLocalOfficialWebSmokeSeedRuntime({
				APP_API_DATABASE_SSLMODE: "disable",
				APP_API_ENVIRONMENT: "development",
				APP_API_INTERNAL_SHARED_SECRET: "internal-secret",
				APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "collector-token",
				APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com,help_bot@outlook.com",
				CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB: "postgres://runtime-db",
			}),
		).toEqual({
			collectorToken: "collector-token",
			env: {
				APP_API_DATABASE_SSLMODE: "disable",
				APP_API_DB: {
					connectionString: "postgres://runtime-db",
				},
				APP_API_ENVIRONMENT: "development",
				APP_API_INTERNAL_SHARED_SECRET: "internal-secret",
				APP_API_MANAGEMENT_DATABASE_URL: undefined,
				APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "collector-token",
				APP_API_OPERATOR_DATABASE_URL: undefined,
				APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com,help_bot@outlook.com",
			},
			operatorEmail: "ops@example.com",
		});
	});
});
