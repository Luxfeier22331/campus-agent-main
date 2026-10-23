import { and, desc, eq, gt, ilike, isNull, lt, or } from "drizzle-orm";

import { emailAccessGrant } from "../../db/schema";
import type { EmailAccessGrantStoreContext } from "./store-context";
import type { EmailAccessGrantStore } from "./store-contract";
import {
	decodeEmailAccessGrantCursor,
	effectiveEmailAccessGrantStateFilter,
	encodeEmailAccessGrantCursor,
	toEffectiveEmailAccessGrantRecord,
	toEmailAccessGrantRecord,
} from "./store-projection";

type EmailAccessGrantReadOperations = Pick<
	EmailAccessGrantStore,
	"findAccountGrant" | "findEmailGrant" | "get" | "list"
>;

export function createEmailAccessGrantReadOperations(
	context: EmailAccessGrantStoreContext,
): EmailAccessGrantReadOperations {
	return {
		async findAccountGrant(query) {
			const db = await context.getDb();
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
			return rows[0] ? toEmailAccessGrantRecord(rows[0]) : null;
		},

		async findEmailGrant(query) {
			const db = await context.getDb();
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
			return rows[0] ? toEmailAccessGrantRecord(rows[0]) : null;
		},

		async get(id) {
			const db = await context.getDb();
			const rows = await db
				.select()
				.from(emailAccessGrant)
				.where(eq(emailAccessGrant.id, id))
				.limit(1);
			return rows[0] ? toEmailAccessGrantRecord(rows[0]) : null;
		},

		async list(query) {
			const db = await context.getDb();
			const cursor = decodeEmailAccessGrantCursor(query.cursor);
			const filters = [eq(emailAccessGrant.environment, query.environment)];
			if (query.email) {
				filters.push(ilike(emailAccessGrant.email, `%${query.email}%`));
			}
			if (query.kind) {
				filters.push(eq(emailAccessGrant.kind, query.kind));
			}
			if (query.state) {
				const stateFilter = effectiveEmailAccessGrantStateFilter(query.state, query.now);
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
			const items = rows
				.slice(0, query.limit)
				.map((row) => toEffectiveEmailAccessGrantRecord(row, query.now));
			const last = items.at(-1);
			return {
				items,
				nextCursor:
					rows.length > query.limit && last
						? encodeEmailAccessGrantCursor({ createdAt: last.createdAt, id: last.id })
						: null,
			};
		},
	};
}
