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
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
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

	it("does not require mail, execution client, or campus-web runtime config when core auth is configured", async () => {
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
