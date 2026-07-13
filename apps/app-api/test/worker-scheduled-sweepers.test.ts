import { describe, expect, it, vi } from "vitest";

import { createWorkerRuntime } from "../src/index";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "example.edu",
	APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function buildScheduledRuntime(input: { envOverrides?: Record<string, string> }) {
	const chatCommandService = {
		reconcileDurableCloseouts: vi.fn().mockResolvedValue({
			failed: 0,
			finalized: 0,
			scanned: 0,
		}),
		submit: vi.fn(),
	};
	const runtime = createWorkerRuntime(
		{
			...env,
			...input.envOverrides,
		},
		{
			chatCommandService,
		},
	);
	return {
		chatCommandService,
		runtime,
	};
}

describe("app-api worker scheduled sweepers", () => {
	it("does not reconcile durable closeouts unless explicitly enabled", async () => {
		const { chatCommandService, runtime } = buildScheduledRuntime({});

		await runtime.scheduled();

		expect(chatCommandService.reconcileDurableCloseouts).not.toHaveBeenCalled();
	});

	it("reconciles durable closeouts when explicitly enabled", async () => {
		const { chatCommandService, runtime } = buildScheduledRuntime({
			envOverrides: {
				APP_API_DURABLE_CLOSEOUT_SWEEPER_ENABLED: "true",
			},
		});

		await runtime.scheduled();

		expect(chatCommandService.reconcileDurableCloseouts).toHaveBeenCalledTimes(1);
	});
});
