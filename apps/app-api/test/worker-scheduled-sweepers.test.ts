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
	APP_API_PRODUCT_CALLBACK_SHARED_SECRET: "product-callback-secret",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("app-api worker scheduled admission recovery", () => {
	it("dispatches only frozen chat admissions through the product service", async () => {
		const dispatchPendingAdmissions = vi.fn(async () => ({
			admitted: 1,
			failed: 0,
			processed: 1,
		}));
		const runtime = createWorkerRuntime(env, {
			chatCommandService: {
				dispatchPendingAdmissions,
				submit: vi.fn(),
			},
		});

		await runtime.scheduled();

		expect(dispatchPendingAdmissions).toHaveBeenCalledTimes(1);
	});

	it("does not dispatch when execution-control admission is not configured", async () => {
		const dispatchPendingAdmissions = vi.fn();
		const runtime = createWorkerRuntime(
			{ ...env, EXECUTION_CONTROL_SHARED_SECRET: "" },
			{
				chatCommandService: {
					dispatchPendingAdmissions,
					submit: vi.fn(),
				},
			},
		);

		await runtime.scheduled();

		expect(dispatchPendingAdmissions).not.toHaveBeenCalled();
	});
});
