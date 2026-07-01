// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/runtime", () => ({
	probeRuntimeDatabase: vi.fn(),
}));

vi.mock("../src/modules/auth", () => ({
	buildBetterAuthConfig: vi.fn(),
	probeAppAuthRuntime: vi.fn(),
}));

vi.mock("../src/modules/integration", () => ({
	probeExecutionControlReady: vi.fn(),
}));

import { defaultRuntimeReadinessProbe } from "../src/app/readiness";
import { probeRuntimeDatabase } from "../src/db/runtime";
import { buildBetterAuthConfig, probeAppAuthRuntime } from "../src/modules/auth";
import { probeExecutionControlReady } from "../src/modules/integration";

const mockedProbeRuntimeDatabase = vi.mocked(probeRuntimeDatabase);
const mockedBuildBetterAuthConfig = vi.mocked(buildBetterAuthConfig);
const mockedProbeAppAuthRuntime = vi.mocked(probeAppAuthRuntime);
const mockedProbeExecutionControlReady = vi.mocked(probeExecutionControlReady);

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "example.edu",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("runtime readiness", () => {
	beforeEach(() => {
		mockedProbeRuntimeDatabase.mockReset();
		mockedBuildBetterAuthConfig.mockReset();
		mockedProbeAppAuthRuntime.mockReset();
		mockedProbeExecutionControlReady.mockReset();
		mockedProbeRuntimeDatabase.mockResolvedValue(undefined);
		mockedBuildBetterAuthConfig.mockReturnValue({} as never);
		mockedProbeAppAuthRuntime.mockResolvedValue(undefined);
		const executionRuntime = {
			status: "ready" as const,
			checks: {
				runProjectionStore: "ready" as const,
				temporalRuntime: "ready" as const,
			},
			blockers: {},
		};
		mockedProbeExecutionControlReady.mockResolvedValue({
			campusServicesProductPath: {
				status: "ready",
				toolGate: "open",
				projectionSource: "postgres",
				checks: {
					toolReadModelRuntime: "ready",
					transportSchedule: "ready",
					transportScheduleReadModel: "ready",
				},
				blockers: {},
			},
			executionRuntime,
			runtimeHealth: {
				asOf: "2026-03-29T08:17:33.000Z",
				executionRuntime,
				status: "ready",
				runProjectionStore: {
					configured: true,
					healthy: true,
					lastError: null,
				},
				temporalRuntime: null,
			},
		});
	});

	it("marks ingestion-control not_configured when task admission is disabled", async () => {
		await expect(defaultRuntimeReadinessProbe(env)).resolves.toMatchObject({
			dependencies: {
				ingestionControl: "not_configured",
			},
			failed: {},
		});
	});

	it("marks ingestion-control misconfigured when admission has no source bucket", async () => {
		await expect(
			defaultRuntimeReadinessProbe({
				...env,
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
			}),
		).resolves.toMatchObject({
			dependencies: {
				ingestionControl: "misconfigured",
			},
			failed: {},
		});
	});

	it("marks ingestion-control configured when admission and source bucket are both configured", async () => {
		await expect(
			defaultRuntimeReadinessProbe({
				...env,
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
				OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			}),
		).resolves.toMatchObject({
			dependencies: {
				ingestionControl: "configured",
			},
			failed: {},
		});
	});
});
