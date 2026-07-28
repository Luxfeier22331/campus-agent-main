// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/runtime", () => ({
	probeRuntimeDatabase: vi.fn(),
	withRuntimeDatabase: vi.fn(),
}));

vi.mock("../src/modules/auth", () => ({
	probeAppAuthRuntime: vi.fn(),
}));

import { defaultDocsReadinessProbe } from "../src/app/docs-readiness";
import { probeRuntimeDatabase, withRuntimeDatabase } from "../src/db/runtime";
import { probeAppAuthRuntime } from "../src/modules/auth";

const mockedProbeRuntimeDatabase = vi.mocked(probeRuntimeDatabase);
const mockedWithRuntimeDatabase = vi.mocked(withRuntimeDatabase);
const mockedProbeAppAuthRuntime = vi.mocked(probeAppAuthRuntime);

const env = {
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("docs readiness", () => {
	beforeEach(() => {
		mockedProbeRuntimeDatabase.mockReset();
		mockedWithRuntimeDatabase.mockReset();
		mockedProbeAppAuthRuntime.mockReset();
		mockedProbeRuntimeDatabase.mockResolvedValue(undefined);
		mockedWithRuntimeDatabase.mockResolvedValue(undefined as never);
		mockedProbeAppAuthRuntime.mockResolvedValue(undefined);
	});

	it("does not require executionClient or campus-web runtime config when docs auth shell is configured", async () => {
		await expect(defaultDocsReadinessProbe(env, `sha256:${"a".repeat(64)}`)).resolves.toEqual({
			dependencies: {
				auth: "ready",
				database: "ready",
				docsReadModel: "ready",
			},
			failed: {},
		});

		expect(mockedProbeAppAuthRuntime).toHaveBeenCalledWith(env);
	});
});
