import {
	and,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

import { type Env, resolveEnvironment } from "../../config";
import type { RuntimeDbGetter } from "../../db/runtime";
import { createRuntimeDatabase } from "../../db/runtime";
import {
	account,
	accountAdminEvent,
	accountDeletionRequests,
	emailAccessGrant,
	session,
	user,
} from "../../db/schema";
import { CAMPUS_EMAIL_DOMAIN } from "../auth/campus-access";
import type {
	AccountAdminAction,
	AccountAdminEventPage,
	AccountAdminEventRecord,
	AccountAdminEventWindow,
	AccountAdminState,
	AccountAdminUserPage,
	AccountAdminUserSummary,
	AccountDeletionStatusRecord,
} from "./types";

function encodeCursor(input: { at: Date; id: string }): string {
	return btoa(JSON.stringify({ at: input.at.toISOString(), id: input.id }));
}

function decodeCursor(value: string | undefined): { at: Date; id: string } | null {
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

function accountState(row: {
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

function toDeletionRecord(
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

function accountAccessExpressions(environment: string, now: Date) {
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

function toEventRecord(row: typeof accountAdminEvent.$inferSelect): AccountAdminEventRecord {
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

function eventWindowStart(window: AccountAdminEventWindow, now = Date.now()): Date {
	const duration = {
		"24h": 24 * 60 * 60 * 1_000,
		"7d": 7 * 24 * 60 * 60 * 1_000,
		"30d": 30 * 24 * 60 * 60 * 1_000,
		"90d": 90 * 24 * 60 * 60 * 1_000,
	}[window];
	return new Date(now - duration);
}

function escapedPrefix(value: string): string {
	return `${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export interface AccountAdminStore {
	findCommand(
		actorId: string,
		idempotencyKey: string,
	): Promise<{
		action: string;
		fingerprint: string;
		outcome: string;
	} | null>;
	finishCommand(input: {
		actorId: string;
		errorCode?: string;
		idempotencyKey: string;
		succeeded: boolean;
	}): Promise<void>;
	getUser(userId: string): Promise<{
		accessSource: AccountAdminUserSummary["accessSource"];
		accessState: AccountAdminUserSummary["accessState"];
		base: typeof user.$inferSelect | null;
		credentialAccount: boolean;
		deletion: AccountDeletionStatusRecord | null;
		events: AccountAdminEventRecord[];
	}>;
	hasPendingDeletion(userId: string): Promise<boolean>;
	listEvents(input: {
		action?: AccountAdminAction;
		actorId?: string;
		cursor?: string;
		limit: number;
		outcome?: AccountAdminEventRecord["outcome"];
		targetUserId?: string;
		window: AccountAdminEventWindow;
	}): Promise<AccountAdminEventPage>;
	listUsers(input: {
		access?: AccountAdminUserSummary["accessState"];
		cursor?: string;
		limit: number;
		query?: string;
		state?: AccountAdminState;
	}): Promise<AccountAdminUserPage>;
	markStaleCommandsIndeterminate(before: Date): Promise<number>;
	unbanUser(userId: string, now: Date): Promise<"deleting" | "not_found" | "updated">;
	startCommand(input: {
		action: AccountAdminAction;
		actorId: string;
		fingerprint: string;
		idempotencyKey: string;
		reason?: string;
		targetUserId?: string;
	}): Promise<boolean>;
}

export function createPgAccountAdminStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter; now?: () => Date } = {},
): AccountAdminStore {
	const getDb = input.getDb ?? (() => createRuntimeDatabase(env));
	const now = input.now ?? (() => new Date());
	const environment = resolveEnvironment(env);
	return {
		async findCommand(actorId, idempotencyKey) {
			const db = await getDb();
			const rows = await db
				.select({
					action: accountAdminEvent.action,
					fingerprint: accountAdminEvent.requestFingerprint,
					outcome: accountAdminEvent.outcome,
				})
				.from(accountAdminEvent)
				.where(
					and(
						eq(accountAdminEvent.actorId, actorId),
						eq(accountAdminEvent.idempotencyKey, idempotencyKey),
					),
				)
				.limit(1);
			return rows[0] ?? null;
		},

		async finishCommand(command) {
			const db = await getDb();
			const rows = await db
				.update(accountAdminEvent)
				.set({
					errorCode: command.errorCode?.slice(0, 64) ?? null,
					outcome: command.succeeded ? "succeeded" : "failed",
				})
				.where(
					and(
						eq(accountAdminEvent.actorId, command.actorId),
						eq(accountAdminEvent.idempotencyKey, command.idempotencyKey),
					),
				)
				.returning({ eventId: accountAdminEvent.eventId });
			if (rows.length !== 1) {
				throw new Error("account administration audit event was not finalized");
			}
		},

		async getUser(userId) {
			const db = await getDb();
			const access = accountAccessExpressions(environment, now());
			const [users, credentials, deletions, events] = await Promise.all([
				db
					.select({ accessSource: access.source, base: user })
					.from(user)
					.where(eq(user.id, userId))
					.limit(1),
				db
					.select({ id: account.id })
					.from(account)
					.where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
					.limit(1),
				db
					.select()
					.from(accountDeletionRequests)
					.where(eq(accountDeletionRequests.ownerUserId, userId))
					.limit(1),
				db
					.select()
					.from(accountAdminEvent)
					.where(eq(accountAdminEvent.targetUserId, userId))
					.orderBy(desc(accountAdminEvent.occurredAt))
					.limit(50),
			]);
			return {
				accessSource: users[0]?.accessSource ?? null,
				accessState: users[0]?.accessSource ? "allowed" : "denied",
				base: users[0]?.base ?? null,
				credentialAccount: Boolean(credentials[0]),
				deletion: deletions[0] ? toDeletionRecord(deletions[0]) : null,
				events: events.map(toEventRecord),
			};
		},

		async hasPendingDeletion(userId) {
			const db = await getDb();
			const rows = await db
				.select({ requestId: accountDeletionRequests.requestId })
				.from(accountDeletionRequests)
				.where(
					and(
						eq(accountDeletionRequests.ownerUserId, userId),
						eq(accountDeletionRequests.status, "pending"),
					),
				)
				.limit(1);
			return Boolean(rows[0]);
		},

		async listEvents(query) {
			const db = await getDb();
			const cursor = decodeCursor(query.cursor);
			const filters: SQL[] = [gt(accountAdminEvent.occurredAt, eventWindowStart(query.window))];
			if (query.action) {
				filters.push(eq(accountAdminEvent.action, query.action));
			}
			if (query.actorId) {
				filters.push(eq(accountAdminEvent.actorId, query.actorId));
			}
			if (query.outcome) {
				filters.push(eq(accountAdminEvent.outcome, query.outcome));
			}
			if (query.targetUserId) {
				filters.push(eq(accountAdminEvent.targetUserId, query.targetUserId));
			}
			if (cursor) {
				const cursorFilter = or(
					lt(accountAdminEvent.occurredAt, cursor.at),
					and(
						eq(accountAdminEvent.occurredAt, cursor.at),
						lt(accountAdminEvent.eventId, cursor.id),
					),
				);
				if (cursorFilter) {
					filters.push(cursorFilter);
				}
			}
			const rows = await db
				.select()
				.from(accountAdminEvent)
				.where(and(...filters))
				.orderBy(desc(accountAdminEvent.occurredAt), desc(accountAdminEvent.eventId))
				.limit(query.limit + 1);
			const items = rows.slice(0, query.limit).map(toEventRecord);
			const last = items.at(-1);
			return {
				items,
				nextCursor:
					rows.length > query.limit && last
						? encodeCursor({ at: last.occurredAt, id: last.eventId })
						: null,
			};
		},

		async listUsers(query) {
			const db = await getDb();
			const listedAt = now();
			const access = accountAccessExpressions(environment, listedAt);
			const cursor = decodeCursor(query.cursor);
			const deletionJoin = and(
				eq(accountDeletionRequests.ownerUserId, user.id),
				eq(accountDeletionRequests.status, "pending"),
			);
			const filters: SQL[] = [];
			if (query.access === "allowed") {
				filters.push(access.allowed);
			} else if (query.access === "denied") {
				filters.push(sql`not (${access.allowed})`);
			}
			if (query.query) {
				const normalized = query.query.toLowerCase();
				const queryFilter = query.query.includes("@")
					? or(eq(user.id, query.query), sql`lower(${user.email}) = ${normalized}`)
					: or(
							eq(user.id, query.query),
							sql`lower(${user.email}) like ${escapedPrefix(normalized)} escape '\\'`,
							sql`lower(${user.name}) like ${escapedPrefix(normalized)} escape '\\'`,
						);
				if (queryFilter) {
					filters.push(queryFilter);
				}
			}
			if (cursor) {
				const cursorFilter = or(
					lt(user.createdAt, cursor.at),
					and(eq(user.createdAt, cursor.at), lt(user.id, cursor.id)),
				);
				if (cursorFilter) {
					filters.push(cursorFilter);
				}
			}
			if (query.state === "deleting") {
				filters.push(isNotNull(accountDeletionRequests.requestId));
			}
			if (query.state === "banned") {
				filters.push(isNull(accountDeletionRequests.requestId), eq(user.banned, true));
			}
			if (query.state === "password_change_required") {
				filters.push(
					isNull(accountDeletionRequests.requestId),
					eq(user.banned, false),
					eq(user.passwordChangeRequired, true),
				);
			}
			if (query.state === "unverified") {
				filters.push(
					isNull(accountDeletionRequests.requestId),
					eq(user.banned, false),
					eq(user.passwordChangeRequired, false),
					eq(user.emailVerified, false),
				);
			}
			if (query.state === "active") {
				filters.push(
					isNull(accountDeletionRequests.requestId),
					eq(user.banned, false),
					eq(user.passwordChangeRequired, false),
					eq(user.emailVerified, true),
				);
			}
			const rows = await db
				.select({
					accessSource: access.source,
					banned: user.banned,
					createdAt: user.createdAt,
					deletionRequestId: accountDeletionRequests.requestId,
					email: user.email,
					emailVerified: user.emailVerified,
					id: user.id,
					name: user.name,
					passwordChangeRequired: user.passwordChangeRequired,
					updatedAt: user.updatedAt,
				})
				.from(user)
				.leftJoin(accountDeletionRequests, deletionJoin)
				.where(filters.length > 0 ? and(...filters) : undefined)
				.orderBy(desc(user.createdAt), desc(user.id))
				.limit(query.limit + 1);
			const visibleRows = rows.slice(0, query.limit);
			const sessionCounts =
				visibleRows.length === 0
					? []
					: await db
							.select({ activeSessionCount: count(session.id), userId: session.userId })
							.from(session)
							.where(
								and(
									inArray(
										session.userId,
										visibleRows.map((row) => row.id),
									),
									gt(session.expiresAt, new Date()),
								),
							)
							.groupBy(session.userId);
			const sessionCountByUser = new Map(
				sessionCounts.map((row) => [row.userId, Number(row.activeSessionCount)]),
			);
			const items: AccountAdminUserSummary[] = visibleRows.map((row) => ({
				accessSource: row.accessSource,
				accessState: row.accessSource ? "allowed" : "denied",
				activeSessionCount: sessionCountByUser.get(row.id) ?? 0,
				createdAt: row.createdAt,
				email: row.email,
				emailVerified: row.emailVerified,
				id: row.id,
				name: row.name,
				state: accountState(row),
				updatedAt: row.updatedAt,
			}));
			const last = items.at(-1);
			return {
				items,
				nextCursor:
					rows.length > query.limit && last
						? encodeCursor({ at: last.createdAt, id: last.id })
						: null,
			};
		},

		async markStaleCommandsIndeterminate(before) {
			const db = await getDb();
			const rows = await db
				.update(accountAdminEvent)
				.set({
					errorCode: "audit_finalization_timeout",
					outcome: "indeterminate",
				})
				.where(
					and(eq(accountAdminEvent.outcome, "started"), lt(accountAdminEvent.occurredAt, before)),
				)
				.returning({ eventId: accountAdminEvent.eventId });
			return rows.length;
		},

		async unbanUser(userId, now) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const users = await tx
					.select({ id: user.id })
					.from(user)
					.where(eq(user.id, userId))
					.limit(1)
					.for("update");
				if (!users[0]) {
					return "not_found" as const;
				}
				const deletions = await tx
					.select({ requestId: accountDeletionRequests.requestId })
					.from(accountDeletionRequests)
					.where(
						and(
							eq(accountDeletionRequests.ownerUserId, userId),
							eq(accountDeletionRequests.status, "pending"),
						),
					)
					.limit(1);
				if (deletions[0]) {
					return "deleting" as const;
				}
				await tx
					.update(user)
					.set({
						banExpires: null,
						banReason: null,
						banned: false,
						updatedAt: now,
					})
					.where(eq(user.id, userId));
				return "updated" as const;
			});
		},

		async startCommand(command) {
			const db = await getDb();
			const rows = await db
				.insert(accountAdminEvent)
				.values({
					action: command.action,
					actorId: command.actorId,
					eventId: crypto.randomUUID(),
					idempotencyKey: command.idempotencyKey,
					occurredAt: new Date(),
					outcome: "started",
					reason: command.reason ?? null,
					requestFingerprint: command.fingerprint,
					targetUserId: command.targetUserId ?? null,
				})
				.onConflictDoNothing()
				.returning({ eventId: accountAdminEvent.eventId });
			return Boolean(rows[0]);
		},
	};
}
