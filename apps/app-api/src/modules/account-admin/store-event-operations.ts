import { resolveTimeQuery } from "campus-contracts/ops-time";
import { and, desc, eq, gte, lt, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { accountAdminEvent, user } from "../../db/schema";
import type { AccountAdminStoreContext } from "./store-context";
import type { AccountAdminStore } from "./store-contract";
import {
	decodeAccountAdminCursor,
	encodeAccountAdminCursor,
	toAccountAdminEventRecord,
} from "./store-projection";

type AccountAdminEventOperations = Pick<
	AccountAdminStore,
	"findCommand" | "finishCommand" | "listEvents" | "markStaleCommandsIndeterminate" | "startCommand"
>;

export function createAccountAdminEventOperations(
	context: AccountAdminStoreContext,
): AccountAdminEventOperations {
	return {
		async findCommand(actorId, idempotencyKey) {
			const db = await context.getDb();
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
			const db = await context.getDb();
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

		async listEvents(query) {
			const db = await context.getDb();
			const filtersResolved = resolveTimeQuery(
				{ window: query.window, from: query.from, to: query.to },
				"accountEvents",
			);
			const cursor = decodeAccountAdminCursor(query.cursor);
			const filters: SQL[] = [
				...(filtersResolved.from
					? [gte(accountAdminEvent.occurredAt, new Date(filtersResolved.from))]
					: []),
				...(filtersResolved.to
					? [lt(accountAdminEvent.occurredAt, new Date(filtersResolved.to))]
					: []),
			];
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
			const actor = alias(user, "event_actor");
			const target = alias(user, "event_target");
			const rows = await db
				.select({
					event: accountAdminEvent,
					actorName: actor.name,
					actorEmail: actor.email,
					targetName: target.name,
					targetEmail: target.email,
				})
				.from(accountAdminEvent)
				.leftJoin(actor, eq(actor.id, accountAdminEvent.actorId))
				.leftJoin(target, eq(target.id, accountAdminEvent.targetUserId))
				.where(and(...filters))
				.orderBy(desc(accountAdminEvent.occurredAt), desc(accountAdminEvent.eventId))
				.limit(query.limit + 1);
			const items = rows.slice(0, query.limit).map((row) =>
				toAccountAdminEventRecord(row.event, {
					actor:
						row.actorName && row.actorEmail ? { name: row.actorName, email: row.actorEmail } : null,
					targetUser:
						row.targetName && row.targetEmail
							? { name: row.targetName, email: row.targetEmail }
							: null,
				}),
			);
			const last = items.at(-1);
			return {
				filters: filtersResolved,
				items,
				nextCursor:
					rows.length > query.limit && last
						? encodeAccountAdminCursor({ at: last.occurredAt, id: last.eventId })
						: null,
			};
		},

		async markStaleCommandsIndeterminate(before) {
			const db = await context.getDb();
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

		async startCommand(command) {
			const db = await context.getDb();
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
