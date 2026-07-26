import { describe, expect, it, vi } from "vitest";

import { createWorkerRuntime } from "../src/index";
import type { ProfileMemoryService } from "../src/modules/profile-memory";

const env = {
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
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
		const dispatchPendingMemoryCommands = vi.fn(async () => ({
			admitted: 0,
			failed: 0,
			processed: 0,
		}));
		const runtime = createWorkerRuntime(env, {
			chatCommandService: {
				dispatchPendingAdmissions,
				submit: vi.fn(),
			},
			profileMemoryService: {
				dispatchPending: dispatchPendingMemoryCommands,
			} as unknown as ProfileMemoryService,
		});

		await runtime.scheduled();

		expect(dispatchPendingAdmissions).toHaveBeenCalledTimes(1);
		expect(dispatchPendingMemoryCommands).toHaveBeenCalledTimes(1);
	});

	it("does not dispatch when execution-control admission is not configured", async () => {
		const dispatchPendingAdmissions = vi.fn();
		const dispatchPendingMemoryCommands = vi.fn();
		const runtime = createWorkerRuntime(
			{ ...env, APP_API_EXECUTION_SHARED_SECRET: "" },
			{
				chatCommandService: {
					dispatchPendingAdmissions,
					submit: vi.fn(),
				},
				profileMemoryService: {
					dispatchPending: dispatchPendingMemoryCommands,
				} as unknown as ProfileMemoryService,
			},
		);

		await runtime.scheduled();

		expect(dispatchPendingAdmissions).not.toHaveBeenCalled();
		expect(dispatchPendingMemoryCommands).not.toHaveBeenCalled();
	});
});
