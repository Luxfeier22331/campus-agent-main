import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

import {
	emailAccessGrant,
	emailAccessGrantEvent,
	oauthAccessToken,
	oauthConsent,
	oauthRefreshToken,
	session,
} from "../../db/schema";
import type { EmailAccessGrantStoreContext } from "./store-context";
import type { EmailAccessGrantStore } from "./store-contract";
import { toEmailAccessGrantRecord } from "./store-projection";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

type EmailAccessGrantRevocationOperations = Pick<
	EmailAccessGrantStore,
	"expire" | "revoke" | "revokeSuperseded"
>;

export function createEmailAccessGrantRevocationOperations(
	context: EmailAccessGrantStoreContext,
): EmailAccessGrantRevocationOperations {
	return {
		async expire(command) {
			const db = await context.getDb();
			return db.transaction(async (tx) => {
				const rows = await tx
					.update(emailAccessGrant)
					.set({ state: "expired", updatedAt: command.now })
					.where(
						and(
							eq(emailAccessGrant.environment, command.environment),
							or(
								and(
									eq(emailAccessGrant.state, "pending"),
									lte(emailAccessGrant.claimExpiresAt, command.now),
								),
								and(
									eq(emailAccessGrant.state, "active"),
									lte(emailAccessGrant.accessExpiresAt, command.now),
								),
							),
						),
					)
					.returning({ id: emailAccessGrant.id, userId: emailAccessGrant.userId });
				if (rows.length > 0) {
					await tx.insert(emailAccessGrantEvent).values(
						rows.map((row) => ({
							action: "expired",
							actorId: "system:email-access-sweeper",
							grantId: row.id,
							id: crypto.randomUUID(),
							occurredAt: command.now,
							outcome: "succeeded",
						})),
					);
					const userIds = rows.flatMap((row) => (row.userId ? [row.userId] : []));
					if (userIds.length > 0) {
						await tx.delete(oauthAccessToken).where(inArray(oauthAccessToken.userId, userIds));
						await tx.delete(oauthRefreshToken).where(inArray(oauthRefreshToken.userId, userIds));
						await tx.delete(oauthConsent).where(inArray(oauthConsent.userId, userIds));
						await tx.delete(session).where(inArray(session.userId, userIds));
					}
				}
				const purgeBefore = new Date(command.now.getTime() - RETENTION_MS);
				const purged = await tx
					.delete(emailAccessGrant)
					.where(
						and(
							eq(emailAccessGrant.environment, command.environment),
							inArray(emailAccessGrant.state, ["expired", "revoked"]),
							lt(emailAccessGrant.updatedAt, purgeBefore),
						),
					)
					.returning({ id: emailAccessGrant.id });
				return { expired: rows.length, purged: purged.length };
			});
		},

		async revoke(command) {
			const db = await context.getDb();
			return db.transaction(async (tx) => {
				const replay = await tx
					.select({
						grantId: emailAccessGrantEvent.grantId,
						payloadHash: emailAccessGrantEvent.payloadHash,
					})
					.from(emailAccessGrantEvent)
					.where(
						and(
							eq(emailAccessGrantEvent.actorId, command.actorId),
							eq(emailAccessGrantEvent.idempotencyKey, command.idempotencyKey),
							eq(emailAccessGrantEvent.action, "revoked"),
						),
					)
					.limit(1);
				if (replay[0]) {
					if (replay[0].payloadHash !== command.payloadHash) {
						throw new Error("email_access_idempotency_conflict");
					}
					const rows = await tx
						.select()
						.from(emailAccessGrant)
						.where(eq(emailAccessGrant.id, replay[0].grantId))
						.limit(1);
					return rows[0] ? toEmailAccessGrantRecord(rows[0]) : null;
				}
				const rows = await tx
					.update(emailAccessGrant)
					.set({
						revokedAt: command.now,
						revokedBy: command.actorId,
						state: "revoked",
						updatedAt: command.now,
					})
					.where(
						and(
							eq(emailAccessGrant.id, command.grantId),
							inArray(emailAccessGrant.state, ["pending", "active"]),
						),
					)
					.returning();
				const grant = rows[0];
				if (!grant) {
					return null;
				}
				await tx.insert(emailAccessGrantEvent).values({
					action: "revoked",
					actorId: command.actorId,
					grantId: grant.id,
					id: crypto.randomUUID(),
					idempotencyKey: command.idempotencyKey,
					occurredAt: command.now,
					outcome: "succeeded",
					payloadHash: command.payloadHash,
				});
				if (grant.userId) {
					await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, grant.userId));
					await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, grant.userId));
					await tx.delete(oauthConsent).where(eq(oauthConsent.userId, grant.userId));
					await tx.delete(session).where(eq(session.userId, grant.userId));
				}
				return toEmailAccessGrantRecord(grant);
			});
		},

		async revokeSuperseded(command) {
			const db = await context.getDb();
			await db.transaction(async (tx) => {
				const rows = await tx
					.update(emailAccessGrant)
					.set({
						revokedAt: command.now,
						revokedBy: `system:email-change:${command.userId}`,
						state: "revoked",
						updatedAt: command.now,
					})
					.where(
						and(
							eq(emailAccessGrant.environment, command.environment),
							eq(emailAccessGrant.userId, command.userId),
							eq(emailAccessGrant.state, "active"),
							sql`${emailAccessGrant.email} <> ${command.email}`,
						),
					)
					.returning({ id: emailAccessGrant.id });
				if (rows.length > 0) {
					await tx.insert(emailAccessGrantEvent).values(
						rows.map((row) => ({
							action: "revoked",
							actorId: `system:email-change:${command.userId}`,
							grantId: row.id,
							id: crypto.randomUUID(),
							occurredAt: command.now,
							outcome: "succeeded",
						})),
					);
				}
			});
		},
	};
}
