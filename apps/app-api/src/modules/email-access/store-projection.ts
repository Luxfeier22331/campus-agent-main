import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { AppApiEnvironment } from "../../config";
import { emailAccessGrant } from "../../db/schema";
import type { EmailAccessGrantKind, EmailAccessGrantRecord, EmailAccessGrantState } from "./types";

export function toEmailAccessGrantRecord(
	row: typeof emailAccessGrant.$inferSelect,
): EmailAccessGrantRecord {
	return {
		...row,
		environment: row.environment as AppApiEnvironment,
		kind: row.kind as EmailAccessGrantKind,
		state: row.state as EmailAccessGrantState,
	};
}

export function effectiveEmailAccessGrantStateFilter(state: EmailAccessGrantState, now: Date) {
	if (state === "pending") {
		return and(eq(emailAccessGrant.state, "pending"), gt(emailAccessGrant.claimExpiresAt, now));
	}
	if (state === "active") {
		return and(
			eq(emailAccessGrant.state, "active"),
			or(isNull(emailAccessGrant.accessExpiresAt), gt(emailAccessGrant.accessExpiresAt, now)),
		);
	}
	if (state === "expired") {
		return or(
			eq(emailAccessGrant.state, "expired"),
			and(eq(emailAccessGrant.state, "pending"), lte(emailAccessGrant.claimExpiresAt, now)),
			and(eq(emailAccessGrant.state, "active"), lte(emailAccessGrant.accessExpiresAt, now)),
		);
	}
	return eq(emailAccessGrant.state, "revoked");
}

export function toEffectiveEmailAccessGrantRecord(
	row: typeof emailAccessGrant.$inferSelect,
	now: Date,
): EmailAccessGrantRecord {
	const record = toEmailAccessGrantRecord(row);
	if (
		(record.state === "pending" && record.claimExpiresAt <= now) ||
		(record.state === "active" && record.accessExpiresAt !== null && record.accessExpiresAt <= now)
	) {
		return { ...record, state: "expired" };
	}
	return record;
}

export function encodeEmailAccessGrantCursor(input: { createdAt: Date; id: string }): string {
	return btoa(JSON.stringify({ createdAt: input.createdAt.toISOString(), id: input.id }));
}

export function decodeEmailAccessGrantCursor(
	value: string | undefined,
): { createdAt: Date; id: string } | null {
	if (!value) {
		return null;
	}
	try {
		const parsed = JSON.parse(atob(value)) as { createdAt?: unknown; id?: unknown };
		const createdAt = new Date(typeof parsed.createdAt === "string" ? parsed.createdAt : "");
		return typeof parsed.id === "string" && Number.isFinite(createdAt.getTime())
			? { createdAt, id: parsed.id }
			: null;
	} catch {
		return null;
	}
}
