import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import { emailAccessGrant, emailAccessGrantEvent, user } from "../../db/schema";
import type { EmailAccessGrantStoreContext } from "./store-context";
import type { EmailAccessGrantStore } from "./store-contract";
import { toEmailAccessGrantRecord } from "./store-projection";

type EmailAccessGrantIssuanceOperations = Pick<
	EmailAccessGrantStore,
	"claim" | "create" | "markInvitationSent"
>;

export function createEmailAccessGrantIssuanceOperations(
	context: EmailAccessGrantStoreContext,
): EmailAccessGrantIssuanceOperations {
	return {
		async claim(command) {
			const db = await context.getDb();
			return db.transaction(async (tx) => {
				const activeRows = await tx
					.select()
					.from(emailAccessGrant)
					.where(
						and(
							eq(emailAccessGrant.email, command.email),
							eq(emailAccessGrant.environment, command.environment),
							eq(emailAccessGrant.state, "active"),
							eq(emailAccessGrant.userId, command.userId),
							or(
								isNull(emailAccessGrant.accessExpiresAt),
								gt(emailAccessGrant.accessExpiresAt, command.now),
							),
						),
					)
					.limit(1);
				if (activeRows[0]) {
					return toEmailAccessGrantRecord(activeRows[0]);
				}

				const pendingRows = await tx
					.select()
					.from(emailAccessGrant)
					.where(
						and(
							eq(emailAccessGrant.email, command.email),
							eq(emailAccessGrant.environment, command.environment),
							eq(emailAccessGrant.state, "pending"),
							gt(emailAccessGrant.claimExpiresAt, command.now),
							or(
								isNull(emailAccessGrant.accessExpiresAt),
								gt(emailAccessGrant.accessExpiresAt, command.now),
							),
						),
					)
					.limit(1)
					.for("update");
				const pending = pendingRows[0];
				if (!pending) {
					return null;
				}
				const updated = await tx
					.update(emailAccessGrant)
					.set({
						claimedAt: command.now,
						state: "active",
						updatedAt: command.now,
						userId: command.userId,
					})
					.where(and(eq(emailAccessGrant.id, pending.id), eq(emailAccessGrant.state, "pending")))
					.returning();
				if (!updated[0]) {
					return null;
				}
				await tx.insert(emailAccessGrantEvent).values({
					action: "claimed",
					actorId: `user:${command.userId}`,
					grantId: pending.id,
					id: crypto.randomUUID(),
					occurredAt: command.now,
					outcome: "succeeded",
				});
				return toEmailAccessGrantRecord(updated[0]);
			});
		},

		async create(command) {
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
							eq(emailAccessGrantEvent.action, "created"),
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
					if (rows[0]) {
						return toEmailAccessGrantRecord(rows[0]);
					}
				}

				await tx
					.update(emailAccessGrant)
					.set({ state: "expired", updatedAt: command.now })
					.where(
						and(
							eq(emailAccessGrant.email, command.email),
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
					);

				const existingUser = await tx
					.select({
						emailVerified: user.emailVerified,
						id: user.id,
					})
					.from(user)
					.where(eq(user.email, command.email))
					.limit(1);
				const canActivate = existingUser[0]?.emailVerified === true;
				const grantId = crypto.randomUUID();
				const inserted = await tx
					.insert(emailAccessGrant)
					.values({
						accessExpiresAt: command.accessExpiresAt,
						claimExpiresAt: command.claimExpiresAt,
						claimedAt: canActivate ? command.now : null,
						createdAt: command.now,
						createdBy: command.actorId,
						email: command.email,
						environment: command.environment,
						id: grantId,
						kind: command.kind,
						state: canActivate ? "active" : "pending",
						updatedAt: command.now,
						userId: canActivate ? existingUser[0]?.id : null,
					})
					.returning();
				await tx.insert(emailAccessGrantEvent).values({
					action: "created",
					actorId: command.actorId,
					grantId,
					id: crypto.randomUUID(),
					idempotencyKey: command.idempotencyKey,
					occurredAt: command.now,
					outcome: "succeeded",
					payloadHash: command.payloadHash,
				});
				if (canActivate && existingUser[0]) {
					await tx.insert(emailAccessGrantEvent).values({
						action: "claimed",
						actorId: `system:existing-user:${existingUser[0].id}`,
						grantId,
						id: crypto.randomUUID(),
						occurredAt: command.now,
						outcome: "succeeded",
					});
				}
				const created = inserted[0];
				if (!created) {
					throw new Error("Email access grant insert returned no record.");
				}
				return toEmailAccessGrantRecord(created);
			});
		},

		async markInvitationSent(command) {
			const db = await context.getDb();
			const rows = await db
				.update(emailAccessGrant)
				.set({ lastInvitationSentAt: command.now, updatedAt: command.now })
				.where(eq(emailAccessGrant.id, command.grantId))
				.returning();
			return rows[0] ? toEmailAccessGrantRecord(rows[0]) : null;
		},
	};
}
