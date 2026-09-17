import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { RuntimeDbGetter } from "../../db/runtime";
import {
	accountDeletionRequests,
	conversations,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
	profileMemoryCommands,
	profileMemorySettings,
	requestObservabilityFact,
	session,
	user,
	verification,
} from "../../db/schema";
import { AppApiRouteError } from "../../http";
import {
	acceptDiningAccountDeletion,
	isDiningAccountDeletionComplete,
} from "../dining/lifecycle-store";
import type { AccountLifecycleStore } from "./types";

function accountError(code: string, message: string, status: number): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: false, status });
}

export function createPgAccountLifecycleStore(input: {
	getDb: RuntimeDbGetter;
}): AccountLifecycleStore {
	const getDb = input.getDb;
	return {
		async requestDeletion(request) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const rows = await tx
					.select({ banned: user.banned })
					.from(user)
					.where(eq(user.id, request.ownerUserId))
					.limit(1)
					.for("update");
				const authRecord = rows[0];
				if (!authRecord) {
					throw accountError("ACCOUNT_NOT_FOUND", "This account does not exist.", 404);
				}
				if (authRecord.banned) {
					throw accountError("ACCOUNT_NOT_ACTIVE", "This account is not active.", 409);
				}

				await tx.insert(accountDeletionRequests).values({
					attemptCount: 0,
					nextAttemptAt: request.requestedAt,
					ownerUserId: request.ownerUserId,
					requestId: request.requestId,
					requestedAt: request.requestedAt,
					status: "pending",
					updatedAt: request.requestedAt,
				});
				await acceptDiningAccountDeletion(tx, request);
				await tx
					.update(user)
					.set({
						banExpires: null,
						banReason: "account_deletion_in_progress",
						banned: true,
						updatedAt: request.requestedAt,
					})
					.where(eq(user.id, request.ownerUserId));
				await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, request.ownerUserId));
				await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, request.ownerUserId));
				await tx.delete(oauthConsent).where(eq(oauthConsent.userId, request.ownerUserId));
				await tx.delete(session).where(eq(session.userId, request.ownerUserId));

				return { requestId: request.requestId, status: "deleting" };
			});
		},

		async claimPending({ leaseExpiresAt, leaseToken, limit, now }) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const candidates = tx
					.select({ requestId: accountDeletionRequests.requestId })
					.from(accountDeletionRequests)
					.where(
						and(
							eq(accountDeletionRequests.status, "pending"),
							lte(accountDeletionRequests.nextAttemptAt, now),
							or(
								isNull(accountDeletionRequests.leaseExpiresAt),
								lte(accountDeletionRequests.leaseExpiresAt, now),
							),
						),
					)
					.orderBy(accountDeletionRequests.requestedAt)
					.limit(Math.max(1, limit))
					.for("update", { skipLocked: true });
				const rows = await tx
					.update(accountDeletionRequests)
					.set({ leaseExpiresAt, leaseToken, lastAttemptAt: now, updatedAt: now })
					.where(inArray(accountDeletionRequests.requestId, candidates))
					.returning({
						ownerUserId: accountDeletionRequests.ownerUserId,
						requestId: accountDeletionRequests.requestId,
					});
				return rows.flatMap((row) =>
					typeof row.ownerUserId === "string"
						? [{ ...row, ownerUserId: row.ownerUserId, leaseToken }]
						: [],
				);
			});
		},

		async isMemoryErased(ownerUserId) {
			const db = await getDb();
			const rows = await db
				.select({ lifecycleState: profileMemorySettings.lifecycleState })
				.from(profileMemorySettings)
				.where(eq(profileMemorySettings.ownerUserId, ownerUserId))
				.limit(1);
			return rows[0]?.lifecycleState === "erased";
		},

		async recordFailure(failure) {
			const db = await getDb();
			const rows = await db
				.update(accountDeletionRequests)
				.set({
					attemptCount: sql`${accountDeletionRequests.attemptCount} + 1`,
					lastErrorCode: failure.errorCode.slice(0, 64),
					leaseExpiresAt: null,
					leaseToken: null,
					nextAttemptAt: failure.nextAttemptAt,
					updatedAt: failure.now,
				})
				.where(
					and(
						eq(accountDeletionRequests.requestId, failure.requestId),
						eq(accountDeletionRequests.status, "pending"),
						eq(accountDeletionRequests.leaseToken, failure.leaseToken),
						gt(accountDeletionRequests.leaseExpiresAt, failure.now),
					),
				)
				.returning({ requestId: accountDeletionRequests.requestId });
			return rows.length === 1;
		},

		async defer(request, nextAttemptAt, now) {
			const db = await getDb();
			const rows = await db
				.update(accountDeletionRequests)
				.set({ leaseExpiresAt: null, leaseToken: null, nextAttemptAt, updatedAt: now })
				.where(
					and(
						eq(accountDeletionRequests.requestId, request.requestId),
						eq(accountDeletionRequests.status, "pending"),
						eq(accountDeletionRequests.leaseToken, request.leaseToken),
						gt(accountDeletionRequests.leaseExpiresAt, now),
					),
				)
				.returning({ requestId: accountDeletionRequests.requestId });
			return rows.length === 1;
		},

		async renewLease(request, leaseExpiresAt, now) {
			const db = await getDb();
			const rows = await db
				.update(accountDeletionRequests)
				.set({ leaseExpiresAt, updatedAt: now })
				.where(
					and(
						eq(accountDeletionRequests.requestId, request.requestId),
						eq(accountDeletionRequests.status, "pending"),
						eq(accountDeletionRequests.leaseToken, request.leaseToken),
						gt(accountDeletionRequests.leaseExpiresAt, now),
					),
				)
				.returning({ requestId: accountDeletionRequests.requestId });
			return rows.length === 1;
		},

		async deleteOwnedData(request, now, safetyIdentifier) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const leaseRows = await tx
					.select({ requestId: accountDeletionRequests.requestId })
					.from(accountDeletionRequests)
					.where(
						and(
							eq(accountDeletionRequests.requestId, request.requestId),
							eq(accountDeletionRequests.status, "pending"),
							eq(accountDeletionRequests.leaseToken, request.leaseToken),
							gt(accountDeletionRequests.leaseExpiresAt, now),
						),
					)
					.limit(1)
					.for("update");
				if (!leaseRows[0]) {
					return false;
				}
				const memoryRows = await tx
					.select({ lifecycleState: profileMemorySettings.lifecycleState })
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, request.ownerUserId))
					.limit(1)
					.for("update");
				if (memoryRows[0]?.lifecycleState !== "erased") {
					return false;
				}
				await tx
					.select({ id: user.id })
					.from(user)
					.where(eq(user.id, request.ownerUserId))
					.limit(1)
					.for("update");
				if (!(await isDiningAccountDeletionComplete(tx, request))) {
					return false;
				}

				const conversationRows = await tx
					.select({ id: conversations.id })
					.from(conversations)
					.where(eq(conversations.ownerUserId, request.ownerUserId));
				const observabilityFilters = [
					...(conversationRows.length > 0
						? [
								inArray(
									requestObservabilityFact.conversationId,
									conversationRows.map((row) => row.id),
								),
							]
						: []),
					...(safetyIdentifier
						? [eq(requestObservabilityFact.safetyIdentifier, safetyIdentifier)]
						: []),
				];
				if (observabilityFilters.length > 0) {
					await tx.delete(requestObservabilityFact).where(or(...observabilityFilters));
				}
				await tx.delete(conversations).where(eq(conversations.ownerUserId, request.ownerUserId));
				await tx
					.delete(profileMemoryCommands)
					.where(eq(profileMemoryCommands.ownerUserId, request.ownerUserId));
				await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, request.ownerUserId));
				await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, request.ownerUserId));
				await tx.delete(oauthConsent).where(eq(oauthConsent.userId, request.ownerUserId));
				await tx.delete(oauthClient).where(eq(oauthClient.userId, request.ownerUserId));
				await tx.delete(session).where(eq(session.userId, request.ownerUserId));
				await tx.delete(verification).where(eq(verification.value, request.ownerUserId));
				return true;
			});
		},

		async completeDeletion(request, now) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const leases = await tx
					.select({ requestId: accountDeletionRequests.requestId })
					.from(accountDeletionRequests)
					.where(
						and(
							eq(accountDeletionRequests.requestId, request.requestId),
							eq(accountDeletionRequests.status, "pending"),
							eq(accountDeletionRequests.leaseToken, request.leaseToken),
							gt(accountDeletionRequests.leaseExpiresAt, now),
						),
					)
					.limit(1)
					.for("update");
				if (!leases[0]) {
					return false;
				}
				if (!(await isDiningAccountDeletionComplete(tx, request))) {
					return false;
				}
				await tx
					.delete(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, request.ownerUserId));
				await tx
					.update(accountDeletionRequests)
					.set({
						completedAt: now,
						lastErrorCode: null,
						leaseExpiresAt: null,
						leaseToken: null,
						ownerUserId: null,
						status: "completed",
						updatedAt: now,
					})
					.where(eq(accountDeletionRequests.requestId, request.requestId));
				return true;
			});
		},
	};
}
