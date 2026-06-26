// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/runtime", () => ({
	probeRuntimeDatabase: vi.fn(),
	withRuntimeDatabase: vi.fn(),
}));

vi.mock("../src/modules/auth", () => ({
	buildBetterAuthConfig: vi.fn(),
	probeAppAuthRuntime: vi.fn(),
}));

import { defaultDocsReadinessProbe } from "../src/app/docs-readiness";
import { probeRuntimeDatabase, withRuntimeDatabase } from "../src/db/runtime";
import { buildBetterAuthConfig, probeAppAuthRuntime } from "../src/modules/auth";

const mockedProbeRuntimeDatabase = vi.mocked(probeRuntimeDatabase);
const mockedWithRuntimeDatabase = vi.mocked(withRuntimeDatabase);
const mockedBuildBetterAuthConfig = vi.mocked(buildBetterAuthConfig);
const mockedProbeAppAuthRuntime = vi.mocked(probeAppAuthRuntime);

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("docs readiness", () => {
	beforeEach(() => {
		mockedProbeRuntimeDatabase.mockReset();
		mockedWithRuntimeDatabase.mockReset();
		mockedBuildBetterAuthConfig.mockReset();
		mockedProbeAppAuthRuntime.mockReset();
		mockedProbeRuntimeDatabase.mockResolvedValue(undefined);
		mockedWithRuntimeDatabase.mockResolvedValue(undefined as never);
		mockedBuildBetterAuthConfig.mockReturnValue({} as never);
		mockedProbeAppAuthRuntime.mockResolvedValue(undefined);
	});

	it("does not require executionClient or campus-web runtime config when docs auth shell is configured", async () => {
		await expect(defaultDocsReadinessProbe(env)).resolves.toEqual({
			dependencies: {
				auth: "ready",
				database: "ready",
				docsReadModel: "ready",
			},
			failed: {},
		});

		expect(mockedBuildBetterAuthConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				authShellOrigin: "https://campus.muc.wiki",
			}),
		);
	});
});
