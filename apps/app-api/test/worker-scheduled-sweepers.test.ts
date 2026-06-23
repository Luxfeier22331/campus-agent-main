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
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
	APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function buildScheduledRuntime(input: { envOverrides?: Record<string, string> }) {
	const requestProjector = {
		drain: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
		drainRequest: vi.fn().mockResolvedValue({ failed: 0, processed: 0 }),
	};
	const officialWebProjector = {
		drain: vi.fn().mockResolvedValue({ abandoned: 0, failed: 0, processed: 0, skipped: 0 }),
	};
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
			officialWebProjector,
			requestProjector,
		},
	);
	return {
		chatCommandService,
		officialWebProjector,
		requestProjector,
		runtime,
	};
}

describe("app-api worker scheduled sweepers", () => {
	it("does not run scheduled DB sweepers unless explicitly enabled", async () => {
		const { chatCommandService, officialWebProjector, requestProjector, runtime } =
			buildScheduledRuntime({});

		await runtime.scheduled();

		expect(chatCommandService.reconcileDurableCloseouts).not.toHaveBeenCalled();
		expect(requestProjector.drain).not.toHaveBeenCalled();
		expect(officialWebProjector.drain).not.toHaveBeenCalled();
	});

	it("runs only explicitly enabled scheduled DB sweepers", async () => {
		const { chatCommandService, officialWebProjector, requestProjector, runtime } =
			buildScheduledRuntime({
				envOverrides: {
					APP_API_REQUEST_PROJECTION_SWEEPER_ENABLED: "true",
				},
			});

		await runtime.scheduled();

		expect(chatCommandService.reconcileDurableCloseouts).not.toHaveBeenCalled();
		expect(requestProjector.drain).toHaveBeenCalledTimes(1);
		expect(officialWebProjector.drain).not.toHaveBeenCalled();
	});
});
