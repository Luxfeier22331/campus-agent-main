import type { AppApiEnvironment } from "../../config";

export const EMAIL_ACCESS_GRANT_KINDS = ["invitation", "test"] as const;
export type EmailAccessGrantKind = (typeof EMAIL_ACCESS_GRANT_KINDS)[number];

export const EMAIL_ACCESS_GRANT_STATES = ["pending", "active", "revoked", "expired"] as const;
export type EmailAccessGrantState = (typeof EMAIL_ACCESS_GRANT_STATES)[number];

export interface EmailAccessGrantRecord {
	accessExpiresAt: Date | null;
	claimExpiresAt: Date;
	claimedAt: Date | null;
	createdAt: Date;
	createdBy: string;
	email: string;
	environment: AppApiEnvironment;
	id: string;
	kind: EmailAccessGrantKind;
	lastInvitationSentAt: Date | null;
	revokedAt: Date | null;
	revokedBy: string | null;
	state: EmailAccessGrantState;
	updatedAt: Date;
	userId: string | null;
}

export type EmailAccessDenialReason = "email_access_required" | "email_not_verified";

export type EmailAccessDecision =
	| { allowed: true; source: "campus_email" | "email_grant" }
	| { allowed: false; reason: EmailAccessDenialReason };

export interface EmailAccessUser {
	email?: string | null;
	emailVerified?: boolean | null;
	id?: string | null;
}

export interface EmailAccessGrantPage {
	items: EmailAccessGrantRecord[];
	nextCursor: string | null;
}
