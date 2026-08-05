import { describe, expect, it, vi } from "vitest";

import { AppApiRouteError } from "../src/http";
import { buildAccountAdminService } from "../src/modules/account-admin";

function createService(
	input: {
		findCommand?: () => Promise<{ action: string; fingerprint: string; outcome: string } | null>;
		emailVerified?: boolean;
		finishCommand?: () => Promise<void>;
		hasPendingDeletion?: boolean;
		opsBanUser?: () => Promise<unknown>;
		startCommand?: () => Promise<boolean>;
	} = {},
) {
	const base = {
		banReason: null,
		banned: false,
		createdAt: new Date("2026-07-19T00:00:00.000Z"),
		email: "student@muc.edu.cn",
		emailVerified: input.emailVerified ?? true,
		id: "user_1",
		name: "Student",
		passwordChangeRequired: false,
		temporaryPasswordExpiresAt: null,
		updatedAt: new Date("2026-07-19T00:00:00.000Z"),
	};
	const opsBanUser = vi.fn(input.opsBanUser ?? (async () => ({ found: true })));
	const requestPasswordReset = vi.fn();
	const sendVerificationEmail = vi.fn();
	const store = {
		findCommand: vi.fn(input.findCommand ?? (async () => null)),
		finishCommand: vi.fn(input.finishCommand ?? (async () => undefined)),
		getUser: vi.fn().mockResolvedValue({
			accessSource: "campus_email",
			accessState: "allowed",
			base,
			credentialAccount: true,
			deletion: null,
			events: [],
		}),
		hasPendingDeletion: vi.fn().mockResolvedValue(input.hasPendingDeletion ?? false),
		listEvents: vi.fn(),
		listUsers: vi.fn(),
		markStaleCommandsIndeterminate: vi.fn(),
		startCommand: vi.fn(input.startCommand ?? (async () => true)),
	};
	const auth = {
		api: {
			opsBanUser,
			opsListUserSessions: vi.fn().mockResolvedValue({ sessions: [] }),
			requestPasswordReset,
			sendVerificationEmail,
		},
	};
	return {
		opsBanUser,
		requestPasswordReset,
		sendVerificationEmail,
		service: buildAccountAdminService({
			auditRetryDelaysMs: [0, 0, 0],
			authOrigin: "https://campus.example.test",
			getAppAuth: async () => auth as never,
			store: store as never,
		}),
		store,
	};
}

describe("account administration service", () => {
	it("retries audit finalization without repeating the account operation", async () => {
		const finishCommand = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary audit failure"))
			.mockRejectedValueOnce(new Error("temporary audit failure"))
			.mockResolvedValue(undefined);
		const { opsBanUser, service } = createService({ finishCommand });

		await expect(
			service.banUser({
				actorId: "operator@example.test",
				idempotencyKey: "ban-transient",
				reason: "Policy violation",
				userId: "user_1",
			}),
		).resolves.toMatchObject({ id: "user_1" });
		expect(finishCommand).toHaveBeenCalledTimes(3);
		expect(opsBanUser).toHaveBeenCalledTimes(1);
	});

	it("does not report a successful account operation as failed when audit finalization remains unavailable", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { opsBanUser, service } = createService({
			finishCommand: async () => {
				throw new Error("audit database unavailable");
			},
		});

		await expect(
			service.banUser({
				actorId: "operator@example.test",
				idempotencyKey: "ban-1",
				reason: "Policy violation",
				userId: "user_1",
			}),
		).resolves.toMatchObject({ id: "user_1" });
		expect(opsBanUser).toHaveBeenCalledTimes(1);
		expect(consoleError).toHaveBeenCalledWith(
			expect.objectContaining({
				audit_attempts: 3,
				error_code: "account_admin_audit_finalize_failed",
			}),
		);
		consoleError.mockRestore();
	});

	it("replays a completed command without repeating its side effect", async () => {
		const { opsBanUser, service, store } = createService({
			findCommand: async () => ({
				action: "account_banned",
				fingerprint: "78fba7de566b3ade165a5213de80a9ac3281e9f9e4367d037bf4664baf5dcce4",
				outcome: "succeeded",
			}),
			startCommand: async () => false,
		});
		await expect(
			service.banUser({
				actorId: "operator@example.test",
				idempotencyKey: "ban-replayed",
				reason: "Policy violation",
				userId: "user_1",
			}),
		).resolves.toMatchObject({ id: "user_1" });
		expect(opsBanUser).not.toHaveBeenCalled();
		expect(store.finishCommand).not.toHaveBeenCalled();
	});

	it.each([
		["started", "account_admin_command_in_progress"],
		["indeterminate", "account_admin_command_outcome_unknown"],
		["failed", "account_admin_command_failed"],
	])("returns a stable conflict for a %s command", async (outcome, code) => {
		const fingerprint = "78fba7de566b3ade165a5213de80a9ac3281e9f9e4367d037bf4664baf5dcce4";
		const { service } = createService({
			findCommand: async () => ({ action: "account_banned", fingerprint, outcome }),
			startCommand: async () => false,
		});
		await expect(
			service.banUser({
				actorId: "operator@example.test",
				idempotencyKey: `ban-${outcome}`,
				reason: "Policy violation",
				userId: "user_1",
			}),
		).rejects.toMatchObject({ code });
	});

	it("records the stable App API error code for a failed operation", async () => {
		const failure = new AppApiRouteError({
			code: "account_policy_rejected",
			message: "Rejected",
			retryable: false,
			status: 409,
		});
		const { service, store } = createService({
			opsBanUser: async () => {
				throw failure;
			},
		});

		await expect(
			service.banUser({
				actorId: "operator@example.test",
				idempotencyKey: "ban-2",
				reason: "Policy violation",
				userId: "user_1",
			}),
		).rejects.toBe(failure);
		expect(store.finishCommand).toHaveBeenCalledWith({
			actorId: "operator@example.test",
			errorCode: "account_policy_rejected",
			idempotencyKey: "ban-2",
			succeeded: false,
		});
	});

	it("does not send recovery mail after account deletion starts", async () => {
		const { requestPasswordReset, service } = createService({ hasPendingDeletion: true });

		await expect(
			service.sendPasswordResetEmail({
				actorId: "operator@example.test",
				idempotencyKey: "reset-1",
				userId: "user_1",
			}),
		).rejects.toMatchObject({ code: "account_deletion_in_progress" });
		expect(requestPasswordReset).not.toHaveBeenCalled();
	});

	it("uses a product return target when an operator resends verification mail", async () => {
		const { sendVerificationEmail, service } = createService({ emailVerified: false });

		await expect(
			service.sendVerificationEmail({
				actorId: "operator@example.test",
				idempotencyKey: "verify-1",
				userId: "user_1",
			}),
		).resolves.toMatchObject({ id: "user_1" });
		expect(sendVerificationEmail).toHaveBeenCalledWith({
			body: {
				callbackURL: "https://campus.example.test/account",
				email: "student@muc.edu.cn",
			},
			headers: expect.any(Headers),
		});
	});
});
