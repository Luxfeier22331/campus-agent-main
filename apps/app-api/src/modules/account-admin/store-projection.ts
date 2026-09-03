import { sql } from "drizzle-orm";

import {
	type accountAdminEvent,
	type accountDeletionRequests,
	emailAccessGrant,
	user,
} from "../../db/schema";
import { CAMPUS_EMAIL_DOMAIN } from "../email-access/campus-email";
import type {
	AccountAdminAction,
	AccountAdminEventRecord,
	AccountAdminEventWindow,
	AccountAdminState,
	AccountDeletionStatusRecord,
} from "./types";

export function encodeAccountAdminCursor(input: { at: Date; id: string }): string {
	return btoa(JSON.stringify({ at: input.at.toISOString(), id: input.id }));
}

export function decodeAccountAdminCursor(
	value: string | undefined,
): { at: Date; id: string } | null {
	if (!value) {
		return null;
	}
	try {
		const parsed = JSON.parse(atob(value)) as { at?: unknown; id?: unknown };
		const at = new Date(typeof parsed.at === "string" ? parsed.at : "");
		return typeof parsed.id === "string" && Number.isFinite(at.getTime())
			? { at, id: parsed.id }
			: null;
	} catch {
		return null;
	}
}

export function accountAdminState(row: {
	banned: boolean;
	deletionRequestId: string | null;
	emailVerified: boolean;
	passwordChangeRequired: boolean;
}): AccountAdminState {
	if (row.deletionRequestId) {
		return "deleting";
	}
	if (row.banned) {
		return "banned";
	}
	if (row.passwordChangeRequired) {
		return "password_change_required";
	}
	if (!row.emailVerified) {
		return "unverified";
	}
	return "active";
}

export function toAccountDeletionRecord(
	row: typeof accountDeletionRequests.$inferSelect,
): AccountDeletionStatusRecord {
	return {
		attemptCount: row.attemptCount,
		completedAt: row.completedAt,
		lastAttemptAt: row.lastAttemptAt,
		lastErrorCode: row.lastErrorCode,
		nextAttemptAt: row.nextAttemptAt,
		requestId: row.requestId,
		requestedAt: row.requestedAt,
		status: row.status as "completed" | "pending",
		updatedAt: row.updatedAt,
	};
}

export function accountAccessExpressions(environment: string, now: Date) {
	const campusEmail = sql<boolean>`lower(${user.email}) like ${`%@${CAMPUS_EMAIL_DOMAIN}`}`;
	const activeGrant = sql<boolean>`exists (
		select 1 from ${emailAccessGrant}
		where ${emailAccessGrant.userId} = ${user.id}
			and ${emailAccessGrant.email} = lower(${user.email})
			and ${emailAccessGrant.environment} = ${environment}
			and ${emailAccessGrant.state} = 'active'
			and (${emailAccessGrant.accessExpiresAt} is null or ${emailAccessGrant.accessExpiresAt} > ${now})
	)`;
	const allowed = sql<boolean>`${user.emailVerified} = true and (${campusEmail} or ${activeGrant})`;
	const source = sql<"campus_email" | "email_grant" | null>`case
		when ${user.emailVerified} = true and ${campusEmail} then 'campus_email'
		when ${user.emailVerified} = true and ${activeGrant} then 'email_grant'
		else null
	end`;
	return { allowed, source };
}

export function toAccountAdminEventRecord(
	row: typeof accountAdminEvent.$inferSelect,
): AccountAdminEventRecord {
	return {
		action: row.action as AccountAdminAction,
		actorId: row.actorId,
		errorCode: row.errorCode,
		eventId: row.eventId,
		occurredAt: row.occurredAt,
		outcome: row.outcome as AccountAdminEventRecord["outcome"],
		reason: row.reason,
		targetUserId: row.targetUserId,
	};
}

export function accountAdminEventWindowStart(
	window: AccountAdminEventWindow,
	now = Date.now(),
): Date {
	const duration = {
		"24h": 24 * 60 * 60 * 1_000,
		"7d": 7 * 24 * 60 * 60 * 1_000,
		"30d": 30 * 24 * 60 * 60 * 1_000,
		"90d": 90 * 24 * 60 * 60 * 1_000,
	}[window];
	return new Date(now - duration);
}

export function escapedAccountAdminPrefix(value: string): string {
	return `${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
