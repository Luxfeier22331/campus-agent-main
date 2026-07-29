import { and, desc, eq, gt, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { AppApiEnvironment, Env } from "../../config";
import type { RuntimeDbGetter } from "../../db/runtime";
import { createRuntimeDatabase } from "../../db/runtime";
import {
	emailAccessGrant,
	emailAccessGrantEvent,
	oauthAccessToken,
	oauthConsent,
	oauthRefreshToken,
	session,
	user,
} from "../../db/schema";
import type {
	EmailAccessGrantKind,
	EmailAccessGrantPage,
	EmailAccessGrantRecord,
	EmailAccessGrantState,
} from "./types";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

function toRecord(row: typeof emailAccessGrant.$inferSelect): EmailAccessGrantRecord {
	return {
		...row,
		environment: row.environment as AppApiEnvironment,
		kind: row.kind as EmailAccessGrantKind,
		state: row.state as EmailAccessGrantState,
	};
}

function effectiveStateFilter(state: EmailAccessGrantState, now: Date) {
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

function toEffectiveRecord(
	row: typeof emailAccessGrant.$inferSelect,
	now: Date,
): EmailAccessGrantRecord {
	const record = toRecord(row);
	if (
		(record.state === "pending" && record.claimExpiresAt <= now) ||
		(record.state === "active" && record.accessExpiresAt !== null && record.accessExpiresAt <= now)
	) {
		return { ...record, state: "expired" };
	}
	return record;
}

function encodeCursor(input: { createdAt: Date; id: string }): string {
	return btoa(JSON.stringify({ createdAt: input.createdAt.toISOString(), id: input.id }));
}

function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | null {
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

export interface EmailAccessGrantStore {
	claim(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
		userId: string;
	}): Promise<EmailAccessGrantRecord | null>;
	create(input: {
		accessExpiresAt: Date | null;
		actorId: string;
		claimExpiresAt: Date;
		email: string;
		environment: AppApiEnvironment;
		idempotencyKey: string;
		kind: EmailAccessGrantKind;
		now: Date;
		payloadHash: string;
	}): Promise<EmailAccessGrantRecord>;
	expire(input: {
		environment: AppApiEnvironment;
		now: Date;
	}): Promise<{ expired: number; purged: number }>;
	findAccountGrant(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
		userId: string;
	}): Promise<EmailAccessGrantRecord | null>;
	findEmailGrant(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
	}): Promise<EmailAccessGrantRecord | null>;
	get(id: string): Promise<EmailAccessGrantRecord | null>;
	list(input: {
		cursor?: string;
		email?: string;
		environment: AppApiEnvironment;
		kind?: EmailAccessGrantKind;
		limit: number;
		now: Date;
		state?: EmailAccessGrantState;
	}): Promise<EmailAccessGrantPage>;
	markInvitationSent(input: { grantId: string; now: Date }): Promise<EmailAccessGrantRecord | null>;
	revoke(input: {
		actorId: string;
		grantId: string;
		idempotencyKey: string;
		now: Date;
		payloadHash: string;
	}): Promise<EmailAccessGrantRecord | null>;
	revokeSuperseded(input: {
		email: string;
		environment: AppApiEnvironment;
		now: Date;
		userId: string;
	}): Promise<void>;
}

export function createPgEmailAccessGrantStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): EmailAccessGrantStore {
	const getDb = input.getDb ?? (() => createRuntimeDatabase(env));
	return {
		async findEmailGrant(query) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(emailAccessGrant)
				.where(
					and(
						eq(emailAccessGrant.email, query.email),
						eq(emailAccessGrant.environment, query.environment),
						or(
							and(
								eq(emailAccessGrant.state, "pending"),
								gt(emailAccessGrant.claimExpiresAt, query.now),
							),
							and(
								eq(emailAccessGrant.state, "active"),
								or(
									isNull(emailAccessGrant.accessExpiresAt),
									gt(emailAccessGrant.accessExpiresAt, query.now),
								),
							),
						),
					),
				)
				.limit(1);
			return rows[0] ? toRecord(rows[0]) : null;
		},

		async findAccountGrant(query) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(emailAccessGrant)
				.where(
					and(
						eq(emailAccessGrant.email, query.email),
						eq(emailAccessGrant.environment, query.environment),
						eq(emailAccessGrant.state, "active"),
						eq(emailAccessGrant.userId, query.userId),
						or(
							isNull(emailAccessGrant.accessExpiresAt),
							gt(emailAccessGrant.accessExpiresAt, query.now),
						),
					),
				)
				.limit(1);
			return rows[0] ? toRecord(rows[0]) : null;
		},

		async claim(command) {
			const db = await getDb();
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
					return toRecord(activeRows[0]);
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
				return toRecord(updated[0]);
			});
		},

		async revokeSuperseded(command) {
			const db = await getDb();
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

		async create(command) {
			const db = await getDb();
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
						return toRecord(rows[0]);
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
				return toRecord(inserted[0]);
			});
		},

		async get(id) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(emailAccessGrant)
				.where(eq(emailAccessGrant.id, id))
				.limit(1);
			return rows[0] ? toRecord(rows[0]) : null;
		},

		async list(query) {
			const db = await getDb();
			const cursor = decodeCursor(query.cursor);
			const filters = [eq(emailAccessGrant.environment, query.environment)];
			if (query.email) {
				filters.push(ilike(emailAccessGrant.email, `%${query.email}%`));
			}
			if (query.kind) {
				filters.push(eq(emailAccessGrant.kind, query.kind));
			}
			if (query.state) {
				const stateFilter = effectiveStateFilter(query.state, query.now);
				if (stateFilter) {
					filters.push(stateFilter);
				}
			}
			if (cursor) {
				const cursorFilter = or(
					lt(emailAccessGrant.createdAt, cursor.createdAt),
					and(eq(emailAccessGrant.createdAt, cursor.createdAt), lt(emailAccessGrant.id, cursor.id)),
				);
				if (cursorFilter) {
					filters.push(cursorFilter);
				}
			}
			const rows = await db
				.select()
				.from(emailAccessGrant)
				.where(and(...filters))
				.orderBy(desc(emailAccessGrant.createdAt), desc(emailAccessGrant.id))
				.limit(query.limit + 1);
			const items = rows.slice(0, query.limit).map((row) => toEffectiveRecord(row, query.now));
			const last = items.at(-1);
			return {
				items,
				nextCursor:
					rows.length > query.limit && last
						? encodeCursor({ createdAt: last.createdAt, id: last.id })
						: null,
			};
		},

		async revoke(command) {
			const db = await getDb();
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
					return rows[0] ? toRecord(rows[0]) : null;
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
				return toRecord(grant);
			});
		},

		async markInvitationSent(command) {
			const db = await getDb();
			const rows = await db
				.update(emailAccessGrant)
				.set({ lastInvitationSentAt: command.now, updatedAt: command.now })
				.where(eq(emailAccessGrant.id, command.grantId))
				.returning();
			return rows[0] ? toRecord(rows[0]) : null;
		},

		async expire(command) {
			const db = await getDb();
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
	};
}
