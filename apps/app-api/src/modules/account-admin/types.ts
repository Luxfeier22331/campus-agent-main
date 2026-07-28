import type {
	AccountAdminAccessSource,
	AccountAdminAccessState,
	AccountAdminAction,
	AccountAdminOutcome,
	AccountAdminState,
} from "campus-contracts/account-admin";

export type {
	AccountAdminAccessSource,
	AccountAdminAccessState,
	AccountAdminAction,
	AccountAdminEventWindow,
	AccountAdminOutcome,
	AccountAdminState,
} from "campus-contracts/account-admin";
export {
	ACCOUNT_ADMIN_ACTIONS,
	ACCOUNT_ADMIN_EVENT_WINDOWS,
	ACCOUNT_ADMIN_OUTCOMES,
	ACCOUNT_ADMIN_STATES,
} from "campus-contracts/account-admin";

export interface AccountAdminEventRecord {
	action: AccountAdminAction;
	actorId: string;
	errorCode: string | null;
	eventId: string;
	occurredAt: Date;
	outcome: AccountAdminOutcome;
	reason: string | null;
	targetUserId: string | null;
}

export interface AccountAdminEventPage {
	items: AccountAdminEventRecord[];
	nextCursor: string | null;
}

export interface AccountDeletionAdminRecord {
	attemptCount: number;
	completedAt: Date | null;
	lastAttemptAt: Date | null;
	lastErrorCode: string | null;
	nextAttemptAt: Date;
	ownerUserId: string | null;
	requestId: string;
	requestedAt: Date;
	retryAvailable: boolean;
	status: "completed" | "pending";
	updatedAt: Date;
}

export interface AccountAdminUserSummary {
	accessSource: AccountAdminAccessSource;
	accessState: AccountAdminAccessState;
	activeSessionCount: number;
	createdAt: Date;
	email: string;
	emailVerified: boolean;
	id: string;
	name: string;
	state: AccountAdminState;
	updatedAt: Date;
}

export interface AccountAdminSession {
	createdAt: Date;
	expiresAt: Date;
	id: string;
	ipAddress: string | null;
	updatedAt: Date;
	userAgent: string | null;
}

export interface AccountAdminUserDetail extends AccountAdminUserSummary {
	banReason: string | null;
	credentialAccount: boolean;
	deletion: AccountDeletionAdminRecord | null;
	events: AccountAdminEventRecord[];
	passwordChangeRequired: boolean;
	sessions: AccountAdminSession[];
	temporaryPasswordExpiresAt: Date | null;
}

export interface AccountAdminUserPage {
	items: AccountAdminUserSummary[];
	nextCursor: string | null;
}

export interface AccountDeletionAdminPage {
	items: AccountDeletionAdminRecord[];
	nextCursor: string | null;
}
