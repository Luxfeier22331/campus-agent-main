import { describe, expect, it, vi } from "vitest";

import { createWorkerRuntime, type WorkerRuntimeDependencies } from "../src/index";
import type { ProfileMemoryService } from "../src/modules/profile-memory";
import type { ChatCommandService } from "../src/modules/runtime-command";
import type { RuntimeRunService } from "../src/modules/runtime-run";

const env = {
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	RESEND_API_KEY: "resend_test_key",
	AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function scheduledServices(
	input: {
		dispatchPendingAdmissions?: ChatCommandService["dispatchPendingAdmissions"];
		dispatchPendingCancellations?: RuntimeRunService["dispatchPendingCancellations"];
		dispatchPendingDeletions?: () => Promise<{
			completed: number;
			failed: number;
			processed: number;
		}>;
		dispatchPendingMemoryCommands?: ProfileMemoryService["dispatchPending"];
	} = {},
) {
	return {
		accountLifecycleService: {
			dispatchPending:
				input.dispatchPendingDeletions ??
				vi.fn(async () => ({ completed: 0, failed: 0, processed: 0 })),
			requestDeletion: vi.fn(),
		},
		chatCommandService: {
			dispatchPendingAdmissions: input.dispatchPendingAdmissions,
			submit: vi.fn(),
		} as ChatCommandService,
		profileMemoryService: {
			dispatchPending:
				input.dispatchPendingMemoryCommands ??
				vi.fn(async () => ({ admitted: 0, failed: 0, processed: 0 })),
		} as unknown as ProfileMemoryService,
		runtimeRunService: {
			cancel: vi.fn(),
			dispatchPendingCancellations: input.dispatchPendingCancellations,
			getStatus: vi.fn(),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn(),
		} as RuntimeRunService,
	};
}

describe("app-api worker scheduled recovery", () => {
	it("dispatches admissions, cancellations, memory commands, and account deletions", async () => {
		const dispatchPendingAdmissions = vi.fn(async () => ({
			admitted: 1,
			failed: 0,
			processed: 1,
		}));
		const dispatchPendingCancellations = vi.fn(async () => ({
			delivered: 0,
			failed: 0,
			finalized: 1,
			processed: 1,
		}));
		const dispatchPendingMemoryCommands = vi.fn(async () => ({
			admitted: 0,
			failed: 0,
			processed: 0,
		}));
		const dispatchPendingDeletions = vi.fn(async () => ({
			completed: 0,
			failed: 0,
			processed: 0,
		}));
		const runtime = createWorkerRuntime(
			env,
			scheduledServices({
				dispatchPendingAdmissions,
				dispatchPendingCancellations,
				dispatchPendingDeletions,
				dispatchPendingMemoryCommands,
			}),
		);

		await runtime.scheduled();

		expect(dispatchPendingAdmissions).toHaveBeenCalledTimes(1);
		expect(dispatchPendingCancellations).toHaveBeenCalledTimes(1);
		expect(dispatchPendingMemoryCommands).toHaveBeenCalledTimes(1);
		expect(dispatchPendingDeletions).toHaveBeenCalledTimes(1);
	});

	it("does not dispatch execution-dependent work when execution-control is not configured", async () => {
		const dispatchPendingAdmissions = vi.fn();
		const dispatchPendingCancellations = vi.fn();
		const dispatchPendingMemoryCommands = vi.fn();
		const dispatchPendingDeletions = vi.fn();
		const runtime = createWorkerRuntime(
			{ ...env, APP_API_EXECUTION_SHARED_SECRET: "" },
			scheduledServices({
				dispatchPendingAdmissions,
				dispatchPendingCancellations,
				dispatchPendingDeletions,
				dispatchPendingMemoryCommands,
			}),
		);

		await runtime.scheduled();

		expect(dispatchPendingAdmissions).not.toHaveBeenCalled();
		expect(dispatchPendingCancellations).not.toHaveBeenCalled();
		expect(dispatchPendingMemoryCommands).not.toHaveBeenCalled();
		expect(dispatchPendingDeletions).not.toHaveBeenCalled();
	});

	it("fails closed when the product admission finalizer is missing", async () => {
		const runtime = createWorkerRuntime(
			env,
			scheduledServices({ dispatchPendingCancellations: vi.fn() }),
		);

		await expect(runtime.scheduled()).rejects.toThrow(
			"Chat admission product finalization is not configured.",
		);
	});

	it("fails closed when the run cancellation dispatcher is missing", async () => {
		const runtime = createWorkerRuntime(
			env,
			scheduledServices({
				dispatchPendingAdmissions: vi.fn(async () => ({
					admitted: 0,
					failed: 0,
					processed: 0,
				})),
			}),
		);

		await expect(runtime.scheduled()).rejects.toThrow(
			"Run cancellation dispatcher is not configured.",
		);
	});

	it("rejects a partial scheduled service injection at the composition root", () => {
		expect(() =>
			createWorkerRuntime(env, {
				chatCommandService: { submit: vi.fn() },
			} as unknown as WorkerRuntimeDependencies),
		).toThrow("Scheduled chat command and runtime run services must be configured together.");
		expect(() =>
			createWorkerRuntime(env, {
				runtimeRunService: scheduledServices().runtimeRunService,
			} as unknown as WorkerRuntimeDependencies),
		).toThrow("Scheduled chat command and runtime run services must be configured together.");
	});
});
