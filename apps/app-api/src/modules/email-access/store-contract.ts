import type { AppApiEnvironment } from "../../config";
import type {
	EmailAccessGrantKind,
	EmailAccessGrantPage,
	EmailAccessGrantRecord,
	EmailAccessGrantState,
} from "./types";

export interface EmailAccessGrantStore {
	claim(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
		userId: string;
	}): Promise<EmailAccessGrantRecord | null>;
	create(input: {
		accessExpiresAt: Date | null;
		actorId: string;
		claimExpiresAt: Date;
		email: string;
		environment: AppApiEnvironment;
		idempotencyKey: string;
		kind: EmailAccessGrantKind;
		now: Date;
		payloadHash: string;
	}): Promise<EmailAccessGrantRecord>;
	expire(input: {
		environment: AppApiEnvironment;
		now: Date;
	}): Promise<{ expired: number; purged: number }>;
	findAccountGrant(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
		userId: string;
	}): Promise<EmailAccessGrantRecord | null>;
	findEmailGrant(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
	}): Promise<EmailAccessGrantRecord | null>;
	get(id: string): Promise<EmailAccessGrantRecord | null>;
	list(input: {
		cursor?: string;
		email?: string;
		environment: AppApiEnvironment;
		kind?: EmailAccessGrantKind;
		limit: number;
		now: Date;
		state?: EmailAccessGrantState;
	}): Promise<EmailAccessGrantPage>;
	markInvitationSent(input: { grantId: string; now: Date }): Promise<EmailAccessGrantRecord | null>;
	revoke(input: {
		actorId: string;
		grantId: string;
		idempotencyKey: string;
		now: Date;
		payloadHash: string;
	}): Promise<EmailAccessGrantRecord | null>;
	revokeSuperseded(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
		userId: string;
	}): Promise<void>;
}
