import { APIError } from "better-auth/api";

import type { AppApiEnvironment } from "../../config";
import { AppApiRouteError } from "../../http";
import { isCampusEmail, normalizeCampusEmail } from "./campus-email";
import type { EmailAccessGrantStore } from "./store";
import type {
	EmailAccessDecision,
	EmailAccessGrantKind,
	EmailAccessGrantPage,
	EmailAccessGrantRecord,
	EmailAccessGrantState,
	EmailAccessUser,
} from "./types";

const DEFAULT_CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_TEST_ACCESS_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

async function sha256(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireEmail(value: string): string {
	const email = normalizeCampusEmail(value);
	if (!email || email.length > 320) {
		throw new AppApiRouteError({
			code: "invalid_email",
			message: "A valid email address is required.",
			retryable: false,
			status: 400,
		});
	}
	return email;
}

function grantError(code: string, message: string, status: number): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: false, status });
}

export interface EmailAccessService {
	assertAccountAccess(user: EmailAccessUser): Promise<void>;
	assertEmailEnrollment(email: string): Promise<void>;
	claimVerifiedUser(user: EmailAccessUser): Promise<EmailAccessDecision>;
	createGrant(input: {
		accessExpiresAt?: Date | null;
		actorId: string;
		claimExpiresAt?: Date;
		email: string;
		idempotencyKey: string;
		kind: EmailAccessGrantKind;
	}): Promise<EmailAccessGrantRecord>;
	evaluateAccountAccess(user: EmailAccessUser): Promise<EmailAccessDecision>;
	expire(): Promise<{ expired: number; purged: number }>;
	getGrant(id: string): Promise<EmailAccessGrantRecord | null>;
	listGrants(input: {
		cursor?: string;
		email?: string;
		kind?: EmailAccessGrantKind;
		limit: number;
		state?: EmailAccessGrantState;
	}): Promise<EmailAccessGrantPage>;
	markInvitationSent(grantId: string): Promise<EmailAccessGrantRecord>;
	revokeGrant(input: {
		actorId: string;
		grantId: string;
		idempotencyKey: string;
	}): Promise<EmailAccessGrantRecord>;
}

export function buildEmailAccessService(input: {
	environment: AppApiEnvironment;
	now?: () => Date;
	store: EmailAccessGrantStore;
}): EmailAccessService {
	const now = input.now ?? (() => new Date());
	return {
		async evaluateAccountAccess(authUser) {
			if (authUser.emailVerified !== true) {
				return { allowed: false, reason: "email_not_verified" };
			}
			const email = normalizeCampusEmail(authUser.email);
			const userId = authUser.id?.trim();
			if (!(email && userId)) {
				return { allowed: false, reason: "email_access_required" };
			}
			if (isCampusEmail(email)) {
				return { allowed: true, source: "campus_email" };
			}
			const grant = await input.store.findAccountGrant({
				email,
				environment: input.environment,
				now: now(),
				userId,
			});
			return grant
				? { allowed: true, source: "email_grant" }
				: { allowed: false, reason: "email_access_required" };
		},

		async assertAccountAccess(authUser) {
			let decision = await this.evaluateAccountAccess(authUser);
			if (
				!decision.allowed &&
				decision.reason === "email_access_required" &&
				authUser.emailVerified === true
			) {
				decision = await this.claimVerifiedUser(authUser);
			}
			if (decision.allowed) {
				return;
			}
			const error =
				decision.reason === "email_not_verified"
					? { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." }
					: { code: "EMAIL_ACCESS_REQUIRED", message: "This email is not admitted." };
			throw APIError.from("FORBIDDEN", error);
		},

		async assertEmailEnrollment(value) {
			const email = requireEmail(value);
			if (isCampusEmail(email)) {
				return;
			}
			const grant = await input.store.findEmailGrant({
				email,
				environment: input.environment,
				now: now(),
			});
			if (!grant) {
				throw APIError.from("FORBIDDEN", {
					code: "EMAIL_ACCESS_REQUIRED",
					message: "This email is not admitted.",
				});
			}
		},

		async claimVerifiedUser(authUser) {
			if (authUser.emailVerified !== true) {
				return this.evaluateAccountAccess(authUser);
			}
			const email = normalizeCampusEmail(authUser.email);
			const userId = authUser.id?.trim();
			if (!(email && userId)) {
				return { allowed: false, reason: "email_access_required" };
			}
			if (isCampusEmail(email)) {
				await input.store.revokeSuperseded({
					email,
					environment: input.environment,
					now: now(),
					userId,
				});
				return { allowed: true, source: "campus_email" };
			}
			const grant = await input.store.claim({
				email,
				environment: input.environment,
				now: now(),
				userId,
			});
			if (!grant) {
				return { allowed: false, reason: "email_access_required" };
			}
			await input.store.revokeSuperseded({
				email,
				environment: input.environment,
				now: now(),
				userId,
			});
			return { allowed: true, source: "email_grant" };
		},

		async createGrant(command) {
			const email = requireEmail(command.email);
			if (isCampusEmail(email)) {
				throw grantError(
					"campus_email_grant_not_required",
					"Campus email does not need a grant.",
					400,
				);
			}
			if (command.kind === "test" && input.environment === "production") {
				throw grantError("test_grant_forbidden", "Test grants are not allowed in production.", 400);
			}
			const createdAt = now();
			const claimExpiresAt =
				command.claimExpiresAt ?? new Date(createdAt.getTime() + DEFAULT_CLAIM_WINDOW_MS);
			const accessExpiresAt =
				command.kind === "test"
					? (command.accessExpiresAt ?? new Date(createdAt.getTime() + DEFAULT_TEST_ACCESS_MS))
					: null;
			if (
				claimExpiresAt <= createdAt ||
				claimExpiresAt.getTime() - createdAt.getTime() > MAX_ACCESS_WINDOW_MS ||
				(accessExpiresAt &&
					(accessExpiresAt <= createdAt ||
						accessExpiresAt.getTime() - createdAt.getTime() > MAX_ACCESS_WINDOW_MS ||
						claimExpiresAt > accessExpiresAt))
			) {
				throw grantError(
					"invalid_grant_expiry",
					"Grant expiry is outside the allowed window.",
					400,
				);
			}
			const payloadHash = await sha256(
				JSON.stringify({ accessExpiresAt, claimExpiresAt, email, kind: command.kind }),
			);
			try {
				return await input.store.create({
					accessExpiresAt,
					actorId: command.actorId,
					claimExpiresAt,
					email,
					environment: input.environment,
					idempotencyKey: command.idempotencyKey,
					kind: command.kind,
					now: createdAt,
					payloadHash,
				});
			} catch (error) {
				if (
					(error instanceof Error && error.message === "email_access_idempotency_conflict") ||
					(error && typeof error === "object" && "code" in error && error.code === "23505")
				) {
					throw grantError("email_access_grant_conflict", "A live grant already exists.", 409);
				}
				throw error;
			}
		},

		getGrant(id) {
			return input.store.get(id);
		},

		listGrants(query) {
			return input.store.list({ ...query, environment: input.environment, now: now() });
		},

		async revokeGrant(command) {
			const payloadHash = await sha256(JSON.stringify({ grantId: command.grantId }));
			try {
				const grant = await input.store.revoke({
					...command,
					now: now(),
					payloadHash,
				});
				if (!grant) {
					throw grantError("email_access_grant_not_found", "Grant is not active.", 404);
				}
				return grant;
			} catch (error) {
				if (
					(error instanceof Error && error.message === "email_access_idempotency_conflict") ||
					(error && typeof error === "object" && "code" in error && error.code === "23505")
				) {
					throw grantError("email_access_idempotency_conflict", "Idempotency key was reused.", 409);
				}
				throw error;
			}
		},

		async markInvitationSent(grantId) {
			const grant = await input.store.markInvitationSent({ grantId, now: now() });
			if (!grant) {
				throw grantError("email_access_grant_not_found", "Grant was not found.", 404);
			}
			return grant;
		},

		expire() {
			return input.store.expire({ environment: input.environment, now: now() });
		},
	};
}
