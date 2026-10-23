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
import { alias } from "drizzle-orm/pg-core";

import {
	account,
	accountAdminEvent,
	accountDeletionRequests,
	session,
	user,
} from "../../db/schema";
import type { AccountAdminStoreContext } from "./store-context";
import type { AccountAdminStore } from "./store-contract";
import {
	accountAccessExpressions,
	accountAdminState,
	decodeAccountAdminCursor,
	encodeAccountAdminCursor,
	escapedAccountAdminPrefix,
	toAccountAdminEventRecord,
	toAccountDeletionRecord,
} from "./store-projection";
import type { AccountAdminUserSummary } from "./types";

type AccountAdminUserReadOperations = Pick<
	AccountAdminStore,
	"getUser" | "hasPendingDeletion" | "listUsers"
>;

export function createAccountAdminUserReadOperations(
	context: AccountAdminStoreContext,
): AccountAdminUserReadOperations {
	return {
		async getUser(userId) {
			const db = await context.getDb();
			const access = accountAccessExpressions(context.environment, context.now());
			const eventActor = alias(user, "detail_event_actor");
			const [users, credentials, deletions, events] = await Promise.all([
				db
					.select({ accessSource: access.source, base: user })
					.from(user)
					.where(eq(user.id, userId))
					.limit(1),
				db
					.select({ id: account.id })
					.from(account)
					.where(
						and(
							eq(account.userId, userId),
							eq(account.providerId, "credential"),
							eq(account.accountId, userId),
						),
					)
					.limit(1),
				db
					.select()
					.from(accountDeletionRequests)
					.where(eq(accountDeletionRequests.ownerUserId, userId))
					.limit(1),
				db
					.select()
					.from(accountAdminEvent)
					.leftJoin(eventActor, eq(eventActor.id, accountAdminEvent.actorId))
					.where(eq(accountAdminEvent.targetUserId, userId))
					.orderBy(desc(accountAdminEvent.occurredAt))
					.limit(50),
			]);
			return {
				accessSource: users[0]?.accessSource ?? null,
				accessState: users[0]?.accessSource ? "allowed" : "denied",
				base: users[0]?.base ?? null,
				credentialAccount: Boolean(credentials[0]),
				deletion: deletions[0] ? toAccountDeletionRecord(deletions[0]) : null,
				events: events.map((row) =>
					toAccountAdminEventRecord(row.account_admin_event, {
						actor:
							row.detail_event_actor?.name && row.detail_event_actor?.email
								? { name: row.detail_event_actor.name, email: row.detail_event_actor.email }
								: null,
					}),
				),
			};
		},

		async hasPendingDeletion(userId) {
			const db = await context.getDb();
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

		async listUsers(query) {
			const db = await context.getDb();
			const listedAt = context.now();
			const access = accountAccessExpressions(context.environment, listedAt);
			const cursor = decodeAccountAdminCursor(query.cursor);
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
							sql`lower(${user.email}) like ${escapedAccountAdminPrefix(normalized)} escape '\\'`,
							sql`lower(${user.name}) like ${escapedAccountAdminPrefix(normalized)} escape '\\'`,
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
				state: accountAdminState(row),
				updatedAt: row.updatedAt,
			}));
			const last = items.at(-1);
			return {
				items,
				nextCursor:
					rows.length > query.limit && last
						? encodeAccountAdminCursor({ at: last.createdAt, id: last.id })
						: null,
			};
		},
	};
}
