import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { turnDispatches } from "../../db/schema";
import type {
	RuntimeRunCancellationClaim,
	RuntimeRunCancellationRecord,
	RuntimeRunOwnershipRecord,
	RuntimeRunStore,
} from "./types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toRuntimeRunOwnershipRecord(
	row: typeof turnDispatches.$inferSelect | undefined,
): RuntimeRunOwnershipRecord | null {
	if (!(row?.runId && row.conversationId && row.requestId && row.traceId)) {
		return null;
	}
	return {
		acceptedAt: row.createdAt.toISOString(),
		admissionStatus: row.admissionStatus,
		cancelOutboxStatus: row.cancelOutboxStatus,
		cancelReason: row.cancelReason,
		cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
		conversationId: row.conversationId,
		requestId: row.requestId,
		runId: row.runId,
		status: row.status,
		traceId: row.traceId,
	};
}

function toCancellationRecord(record: RuntimeRunOwnershipRecord): RuntimeRunCancellationRecord {
	if (!record.cancelRequestedAt) {
		throw new Error(`Run ${record.runId} has cancellation state without requested_at.`);
	}
	return { ...record, requestedAt: record.cancelRequestedAt };
}

function toCancellationClaim(
	row: typeof turnDispatches.$inferSelect | undefined,
	leaseToken: string,
): RuntimeRunCancellationClaim | null {
	const record = toRuntimeRunOwnershipRecord(row);
	if (!record?.cancelRequestedAt) {
		return null;
	}
	if (
		record.cancelOutboxStatus !== "local_finalization_pending" &&
		record.cancelOutboxStatus !== "pending_delivery"
	) {
		return null;
	}
	return {
		kind:
			record.cancelOutboxStatus === "local_finalization_pending"
				? "local_finalization"
				: "remote_delivery",
		leaseToken,
		run: toCancellationRecord(record),
	};
}

export function createPgRuntimeRunStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): RuntimeRunStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getOwnedRun(query) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.actorUserId, query.ownerUserId),
						eq(turnDispatches.runId, query.runId),
					),
				)
				.limit(1);
			return toRuntimeRunOwnershipRecord(rows[0]);
		},

		async claimCancellation(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const candidates = tx
					.select({ requestId: turnDispatches.requestId })
					.from(turnDispatches)
					.where(
						and(
							eq(turnDispatches.runId, input.runId),
							inArray(turnDispatches.cancelOutboxStatus, [
								"local_finalization_pending",
								"pending_delivery",
							]),
							or(
								isNull(turnDispatches.cancelLeaseUntil),
								lte(turnDispatches.cancelLeaseUntil, input.now),
							),
						),
					)
					.orderBy(asc(turnDispatches.updatedAt), asc(turnDispatches.requestId))
					.limit(1)
					.for("update", { skipLocked: true });
				const rows = await tx
					.update(turnDispatches)
					.set({
						cancelLeaseToken: input.leaseToken,
						cancelLeaseUntil: input.leaseExpiresAt,
						updatedAt: input.now,
					})
					.where(inArray(turnDispatches.requestId, candidates))
					.returning();
				return toCancellationClaim(rows[0], input.leaseToken);
			});
		},

		async claimPendingCancellations(input) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit, 100));
			return db.transaction(async (tx) => {
				const candidates = tx
					.select({ requestId: turnDispatches.requestId })
					.from(turnDispatches)
					.where(
						and(
							inArray(turnDispatches.cancelOutboxStatus, [
								"local_finalization_pending",
								"pending_delivery",
							]),
							or(
								isNull(turnDispatches.cancelLeaseUntil),
								lte(turnDispatches.cancelLeaseUntil, input.now),
							),
						),
					)
					.orderBy(asc(turnDispatches.updatedAt), asc(turnDispatches.requestId))
					.limit(limit)
					.for("update", { skipLocked: true });
				const rows = await tx
					.update(turnDispatches)
					.set({
						cancelLeaseToken: input.leaseToken,
						cancelLeaseUntil: input.leaseExpiresAt,
						updatedAt: input.now,
					})
					.where(inArray(turnDispatches.requestId, candidates))
					.returning();
				return rows.flatMap((row) => {
					const claim = toCancellationClaim(row, input.leaseToken);
					return claim ? [claim] : [];
				});
			});
		},

		async markCancellationDelivered(input) {
			const db = await getDb();
			const deliveredAt = new Date(input.deliveredAt);
			const rows = await db
				.update(turnDispatches)
				.set({
					cancelAttemptCount: sql<number>`${turnDispatches.cancelAttemptCount} + 1`,
					cancelDeliveredAt: deliveredAt,
					cancelLastAttemptAt: deliveredAt,
					cancelLastErrorCode: null,
					cancelOutboxStatus: "delivered",
					cancelLeaseToken: null,
					cancelLeaseUntil: null,
					updatedAt: deliveredAt,
				})
				.where(
					and(
						eq(turnDispatches.runId, input.runId),
						eq(turnDispatches.cancelOutboxStatus, "pending_delivery"),
						eq(turnDispatches.cancelLeaseToken, input.leaseToken),
					),
				)
				.returning({ runId: turnDispatches.runId });
			return rows.length === 1;
		},

		async recordCancellationFailure(input) {
			const db = await getDb();
			const failedAt = new Date(input.failedAt);
			const rows = await db
				.update(turnDispatches)
				.set({
					cancelAttemptCount: sql<number>`${turnDispatches.cancelAttemptCount} + 1`,
					cancelLastAttemptAt: failedAt,
					cancelLastErrorCode: input.errorCode.slice(0, 64),
					cancelLeaseToken: null,
					cancelLeaseUntil: null,
					updatedAt: failedAt,
				})
				.where(
					and(
						eq(turnDispatches.runId, input.runId),
						inArray(turnDispatches.cancelOutboxStatus, [
							"local_finalization_pending",
							"pending_delivery",
						]),
						eq(turnDispatches.cancelLeaseToken, input.leaseToken),
					),
				)
				.returning({ runId: turnDispatches.runId });
			return rows.length === 1;
		},

		async requestCancellation(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const rows = await tx
					.select()
					.from(turnDispatches)
					.where(
						and(
							eq(turnDispatches.actorUserId, input.ownerUserId),
							eq(turnDispatches.runId, input.runId),
						),
					)
					.limit(1)
					.for("update");
				const current = toRuntimeRunOwnershipRecord(rows[0]);
				if (!current) {
					return null;
				}
				if (current.status !== "accepted" || current.cancelOutboxStatus === "closed") {
					return {
						kind: "terminal" as const,
						run: toCancellationRecord({
							...current,
							cancelRequestedAt: current.cancelRequestedAt ?? input.requestedAt,
						}),
					};
				}
				if (current.cancelOutboxStatus !== "not_requested") {
					const kind =
						current.cancelOutboxStatus === "local_finalization_pending"
							? ("local_finalization" as const)
							: current.cancelOutboxStatus === "delivered"
								? ("remote_delivered" as const)
								: ("remote_delivery" as const);
					return { kind, run: toCancellationRecord(current) };
				}

				const requestedAt = new Date(input.requestedAt);
				const local = current.admissionStatus === "pending_admission";
				const updatedRows = await tx
					.update(turnDispatches)
					.set({
						...(local
							? {
									admissionInputJson: null,
									admissionInputSha256: null,
									admissionStatus: "cancelled",
								}
							: {}),
						cancelOutboxStatus: local ? "local_finalization_pending" : "pending_delivery",
						cancelReason: input.reason,
						cancelRequestedAt: requestedAt,
						cancelLeaseToken: null,
						cancelLeaseUntil: null,
						updatedAt: requestedAt,
					})
					.where(eq(turnDispatches.requestId, current.requestId))
					.returning();
				const updated = toRuntimeRunOwnershipRecord(updatedRows[0]);
				if (!updated) {
					throw new Error(`Run ${current.runId} disappeared while recording cancellation.`);
				}
				return {
					kind: local ? ("local_finalization" as const) : ("remote_delivery" as const),
					run: toCancellationRecord(updated),
				};
			});
		},
	};
}
