import { AppApiRouteError } from "../../http";
import { type AppAuthGetter, getOpsAccountAdminApi } from "../auth";
import type { AccountAdminStore } from "./store";
import type {
	AccountAdminAction,
	AccountAdminEventWindow,
	AccountAdminOutcome,
	AccountAdminState,
	AccountAdminUserDetail,
	AccountDeletionAdminPage,
} from "./types";

interface CommandInput {
	actorId: string;
	idempotencyKey: string;
}

const DEFAULT_AUDIT_RETRY_DELAYS_MS = [0, 50, 200] as const;

export interface AccountAdminService {
	banUser(
		input: CommandInput & { reason: string; userId: string },
	): Promise<AccountAdminUserDetail>;
	getUser(userId: string): Promise<AccountAdminUserDetail>;
	issueTemporaryPassword(input: CommandInput & { reason: string; userId: string }): Promise<{
		expiresAt: Date;
		issuedAt: Date;
		temporaryPassword: string;
	}>;
	listDeletions(input: {
		cursor?: string;
		limit: number;
		status?: "completed" | "needs_attention" | "pending";
	}): Promise<AccountDeletionAdminPage>;
	listEvents(input: {
		action?: AccountAdminAction;
		actorId?: string;
		cursor?: string;
		limit: number;
		outcome?: AccountAdminOutcome;
		targetUserId?: string;
		window: AccountAdminEventWindow;
	}): ReturnType<AccountAdminStore["listEvents"]>;
	listUsers(input: {
		access?: "allowed" | "denied";
		cursor?: string;
		limit: number;
		query?: string;
		state?: AccountAdminState;
	}): ReturnType<AccountAdminStore["listUsers"]>;
	retryDeletion(input: CommandInput & { reason: string; requestId: string }): Promise<void>;
	revokeSession(
		input: CommandInput & { sessionId: string; userId: string },
	): Promise<AccountAdminUserDetail>;
	revokeUserSessions(
		input: CommandInput & { reason: string; userId: string },
	): Promise<AccountAdminUserDetail>;
	sendPasswordResetEmail(input: CommandInput & { userId: string }): Promise<AccountAdminUserDetail>;
	sendVerificationEmail(input: CommandInput & { userId: string }): Promise<AccountAdminUserDetail>;
	unbanUser(
		input: CommandInput & { reason: string; userId: string },
	): Promise<AccountAdminUserDetail>;
}

function routeError(code: string, message: string, status: number): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: status >= 500, status });
}

async function fingerprint(value: unknown): Promise<string> {
	const bytes = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(value)),
	);
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeReason(value: string): string {
	const reason = value.trim();
	if (!reason || reason.length > 500) {
		throw routeError("invalid_reason", "A reason between 1 and 500 characters is required.", 400);
	}
	return reason;
}

function detailState(input: {
	banned: boolean;
	deleting: boolean;
	emailVerified: boolean;
	passwordChangeRequired: boolean;
}): AccountAdminState {
	if (input.deleting) {
		return "deleting";
	}
	if (input.banned) {
		return "banned";
	}
	if (input.passwordChangeRequired) {
		return "password_change_required";
	}
	if (!input.emailVerified) {
		return "unverified";
	}
	return "active";
}

export function buildAccountAdminService(input: {
	auditRetryDelaysMs?: readonly number[];
	authOrigin: string;
	getAppAuth: AppAuthGetter;
	store: AccountAdminStore;
}): AccountAdminService {
	const auditRetryDelaysMs = input.auditRetryDelaysMs ?? DEFAULT_AUDIT_RETRY_DELAYS_MS;
	type UserRecord = Awaited<ReturnType<AccountAdminStore["getUser"]>>;
	type ExistingUserRecord = Omit<UserRecord, "base"> & { base: NonNullable<UserRecord["base"]> };

	async function getExistingUser(userId: string): Promise<ExistingUserRecord> {
		const record = await input.store.getUser(userId);
		if (!record.base) {
			throw routeError("account_user_not_found", "The requested user does not exist.", 404);
		}
		return { ...record, base: record.base };
	}

	async function getUserDetail(userId: string): Promise<AccountAdminUserDetail> {
		const record = await getExistingUser(userId);
		const auth = await input.getAppAuth();
		const response = await getOpsAccountAdminApi(auth).opsListUserSessions({ body: { userId } });
		const sessions = response.sessions.map((candidate) => ({
			createdAt: new Date(candidate.createdAt),
			expiresAt: new Date(candidate.expiresAt),
			id: candidate.id,
			ipAddress: candidate.ipAddress ?? null,
			updatedAt: new Date(candidate.updatedAt),
			userAgent: candidate.userAgent ?? null,
		}));
		return {
			accessSource: record.accessSource,
			accessState: record.accessState,
			activeSessionCount: sessions.filter((candidate) => candidate.expiresAt > new Date()).length,
			banReason: record.base.banReason,
			createdAt: record.base.createdAt,
			credentialAccount: record.credentialAccount,
			deletion: record.deletion,
			email: record.base.email,
			emailVerified: record.base.emailVerified,
			events: record.events,
			id: record.base.id,
			name: record.base.name,
			passwordChangeRequired: record.base.passwordChangeRequired,
			sessions,
			state: detailState({
				banned: record.base.banned,
				deleting: record.deletion?.status === "pending",
				emailVerified: record.base.emailVerified,
				passwordChangeRequired: record.base.passwordChangeRequired,
			}),
			temporaryPasswordExpiresAt: record.base.temporaryPasswordExpiresAt,
			updatedAt: record.base.updatedAt,
		};
	}

	async function reserveCommand(command: {
		action: AccountAdminAction;
		actorId: string;
		idempotencyKey: string;
		payload: unknown;
		reason?: string;
		targetUserId?: string;
	}): Promise<"replayed" | "started"> {
		const requestFingerprint = await fingerprint({
			action: command.action,
			payload: command.payload,
		});
		if (
			await input.store.startCommand({
				action: command.action,
				actorId: command.actorId,
				fingerprint: requestFingerprint,
				idempotencyKey: command.idempotencyKey,
				reason: command.reason,
				targetUserId: command.targetUserId,
			})
		) {
			return "started";
		}
		const existing = await input.store.findCommand(command.actorId, command.idempotencyKey);
		if (
			!existing ||
			existing.action !== command.action ||
			existing.fingerprint !== requestFingerprint
		) {
			throw routeError(
				"account_admin_idempotency_conflict",
				"The idempotency key was reused.",
				409,
			);
		}
		if (existing.outcome === "succeeded") {
			return "replayed";
		}
		if (existing.outcome === "started") {
			throw routeError(
				"account_admin_command_in_progress",
				"The previous command is still in progress.",
				409,
			);
		}
		if (existing.outcome === "indeterminate") {
			throw routeError(
				"account_admin_command_outcome_unknown",
				"The previous command outcome could not be confirmed.",
				409,
			);
		}
		throw routeError(
			"account_admin_command_failed",
			"The previous command failed. Start a new operation to retry.",
			409,
		);
	}

	async function runCommand<T>(command: {
		action: AccountAdminAction;
		actorId: string;
		execute: () => Promise<T>;
		idempotencyKey: string;
		payload: unknown;
		reason?: string;
		targetUserId?: string;
	}): Promise<{ replayed: boolean; value?: T }> {
		if ((await reserveCommand(command)) === "replayed") {
			return { replayed: true };
		}
		try {
			const value = await command.execute();
			await finishAudit({
				actorId: command.actorId,
				idempotencyKey: command.idempotencyKey,
				succeeded: true,
			});
			return { replayed: false, value };
		} catch (error) {
			await finishAudit({
				actorId: command.actorId,
				errorCode:
					error instanceof AppApiRouteError
						? error.code
						: error instanceof Error
							? error.name
							: "account_admin_command_failed",
				idempotencyKey: command.idempotencyKey,
				succeeded: false,
			});
			throw error;
		}
	}

	async function assertNotDeleting(userId: string) {
		if (await input.store.hasPendingDeletion(userId)) {
			throw routeError("account_deletion_in_progress", "The account is being deleted.", 409);
		}
	}

	function trustedHeaders(): Headers {
		return new Headers({ origin: input.authOrigin });
	}

	async function finishAudit(completion: {
		actorId: string;
		errorCode?: string;
		idempotencyKey: string;
		succeeded: boolean;
	}): Promise<void> {
		let lastError: unknown;
		for (const delayMs of auditRetryDelaysMs) {
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
			try {
				await input.store.finishCommand(completion);
				return;
			} catch (error) {
				lastError = error;
			}
		}
		console.error({
			audit_attempts: auditRetryDelaysMs.length,
			error_code: "account_admin_audit_finalize_failed",
			error_type: lastError instanceof Error ? lastError.name : "UnknownError",
			source: "app-api.account-admin",
		});
	}

	return {
		async banUser(command) {
			const reason = normalizeReason(command.reason);
			await getExistingUser(command.userId);
			await assertNotDeleting(command.userId);
			await runCommand({
				action: "account_banned",
				actorId: command.actorId,
				execute: async () => {
					const auth = await input.getAppAuth();
					await getOpsAccountAdminApi(auth).opsBanUser({
						body: { reason, userId: command.userId },
					});
				},
				idempotencyKey: command.idempotencyKey,
				payload: { reason, userId: command.userId },
				reason,
				targetUserId: command.userId,
			});
			return getUserDetail(command.userId);
		},
		getUser: getUserDetail,
		async issueTemporaryPassword(command) {
			const reason = normalizeReason(command.reason);
			await getExistingUser(command.userId);
			await assertNotDeleting(command.userId);
			const result = await runCommand({
				action: "temporary_password_issued",
				actorId: command.actorId,
				execute: async () => {
					const auth = await input.getAppAuth();
					return getOpsAccountAdminApi(auth).opsIssueTemporaryPassword({
						body: { userId: command.userId },
					});
				},
				idempotencyKey: command.idempotencyKey,
				payload: { reason, userId: command.userId },
				reason,
				targetUserId: command.userId,
			});
			if (result.replayed || !result.value?.found) {
				throw routeError(
					"temporary_password_already_issued",
					"The temporary password was already issued and cannot be displayed again.",
					409,
				);
			}
			return {
				expiresAt: new Date(result.value.expiresAt),
				issuedAt: new Date(result.value.issuedAt),
				temporaryPassword: result.value.temporaryPassword,
			};
		},
		listDeletions: (query) => input.store.listDeletions(query),
		listEvents: (query) => input.store.listEvents(query),
		listUsers: (query) => input.store.listUsers(query),
		async retryDeletion(command) {
			const reason = normalizeReason(command.reason);
			await runCommand({
				action: "deletion_retry_requested",
				actorId: command.actorId,
				execute: async () => {
					if (!(await input.store.retryDeletion(command.requestId))) {
						throw routeError("account_deletion_not_pending", "The deletion is not pending.", 409);
					}
				},
				idempotencyKey: command.idempotencyKey,
				payload: { reason, requestId: command.requestId },
				reason,
			});
		},
		async revokeSession(command) {
			await getExistingUser(command.userId);
			await runCommand({
				action: "session_revoked",
				actorId: command.actorId,
				execute: async () => {
					const auth = await input.getAppAuth();
					const result = await getOpsAccountAdminApi(auth).opsRevokeSession({
						body: { sessionId: command.sessionId, userId: command.userId },
					});
					if (!result.found) {
						throw routeError("account_session_not_found", "Session not found.", 404);
					}
				},
				idempotencyKey: command.idempotencyKey,
				payload: { sessionId: command.sessionId, userId: command.userId },
				targetUserId: command.userId,
			});
			return getUserDetail(command.userId);
		},
		async revokeUserSessions(command) {
			const reason = normalizeReason(command.reason);
			await getExistingUser(command.userId);
			await runCommand({
				action: "sessions_revoked",
				actorId: command.actorId,
				execute: async () => {
					const auth = await input.getAppAuth();
					await getOpsAccountAdminApi(auth).opsRevokeUserSessions({
						body: { userId: command.userId },
					});
				},
				idempotencyKey: command.idempotencyKey,
				payload: { reason, userId: command.userId },
				reason,
				targetUserId: command.userId,
			});
			return getUserDetail(command.userId);
		},
		async sendPasswordResetEmail(command) {
			const record = await getExistingUser(command.userId);
			await assertNotDeleting(command.userId);
			await runCommand({
				action: "password_reset_email_sent",
				actorId: command.actorId,
				execute: async () => {
					const auth = await input.getAppAuth();
					await auth.api.requestPasswordReset({
						body: {
							email: record.base?.email ?? "",
							redirectTo: `${input.authOrigin}/account/reset-password`,
						},
						headers: trustedHeaders(),
					});
				},
				idempotencyKey: command.idempotencyKey,
				payload: { userId: command.userId },
				targetUserId: command.userId,
			});
			return getUserDetail(command.userId);
		},
		async sendVerificationEmail(command) {
			const record = await getExistingUser(command.userId);
			await assertNotDeleting(command.userId);
			if (record.base?.emailVerified) {
				throw routeError("account_email_already_verified", "The email is already verified.", 409);
			}
			await runCommand({
				action: "verification_email_sent",
				actorId: command.actorId,
				execute: async () => {
					const auth = await input.getAppAuth();
					await auth.api.sendVerificationEmail({
						body: {
							callbackURL: `${input.authOrigin}/account/login`,
							email: record.base?.email ?? "",
						},
						headers: trustedHeaders(),
					});
				},
				idempotencyKey: command.idempotencyKey,
				payload: { userId: command.userId },
				targetUserId: command.userId,
			});
			return getUserDetail(command.userId);
		},
		async unbanUser(command) {
			const reason = normalizeReason(command.reason);
			await getExistingUser(command.userId);
			await runCommand({
				action: "account_unbanned",
				actorId: command.actorId,
				execute: async () => {
					const result = await input.store.unbanUser(command.userId, new Date());
					if (result === "not_found") {
						throw routeError("account_user_not_found", "The requested user does not exist.", 404);
					}
					if (result === "deleting") {
						throw routeError("account_deletion_in_progress", "The account is being deleted.", 409);
					}
				},
				idempotencyKey: command.idempotencyKey,
				payload: { reason, userId: command.userId },
				reason,
				targetUserId: command.userId,
			});
			return getUserDetail(command.userId);
		},
	};
}
