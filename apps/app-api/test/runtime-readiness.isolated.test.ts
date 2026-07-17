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
	APP_API_PRODUCT_CALLBACK_SHARED_SECRET: "internal-shared-secret",
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
		});
	});

	it("keeps app readiness healthy when the transport current release is unavailable", async () => {
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
				status: "blocked",
				toolGate: "open",
				projectionSource: "postgres",
				checks: {
					toolReadModelRuntime: "ready",
					transportSchedule: "not_ready",
					transportScheduleReadModel: "ready",
				},
				blockers: {
					transportSchedule: "transport_schedule_implemented is false",
				},
			},
			executionRuntime,
		});

		await expect(defaultRuntimeReadinessProbe(env)).resolves.toMatchObject({
			dependencies: {
				executionControl: "ready",
			},
			failed: {},
			preflight: {
				campusServicesProductPath: {
					status: "blocked",
					checks: {
						transportSchedule: "not_ready",
					},
				},
			},
		});
	});
});
