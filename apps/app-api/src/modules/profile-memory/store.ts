import { and, asc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { profileMemoryItems, profileMemorySettings } from "../../db/schema";
import type { ProfileMemoryItem, ProfileMemoryList, ProfileMemoryProjectionItem } from "./model";
import { toIsoString } from "./model";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface ProfileMemoryStore {
	deleteItem(input: { itemId: string; ownerUserId: string }): Promise<boolean>;
	listByOwner(ownerUserId: string): Promise<ProfileMemoryList>;
	listProjectionItems(input: { ownerUserId: string }): Promise<ProfileMemoryProjectionItem[]>;
	setEnabled(input: { enabled: boolean; ownerUserId: string; updatedAt: string }): Promise<boolean>;
	upsertUserDeclared(input: {
		itemId: string;
		key: string;
		ownerUserId: string;
		updatedAt: string;
		value: string;
	}): Promise<ProfileMemoryItem>;
}

export type ProfileMemoryProjectionStore = Pick<ProfileMemoryStore, "listProjectionItems">;

function toItem(row: typeof profileMemoryItems.$inferSelect): ProfileMemoryItem {
	return {
		confidence: row.confidence as ProfileMemoryItem["confidence"],
		itemId: row.itemId,
		key: row.key,
		lastVerifiedAt: toIsoString(row.lastVerifiedAt),
		sourceType: row.sourceType as ProfileMemoryItem["sourceType"],
		updatedAt: toIsoString(row.updatedAt),
		value: row.value,
		visibility: row.visibility as ProfileMemoryItem["visibility"],
	};
}

function toProjectionItem(
	row: typeof profileMemoryItems.$inferSelect,
): ProfileMemoryProjectionItem {
	const item = toItem(row);
	const { updatedAt, ...projectionItem } = item;
	return projectionItem;
}

async function isProjectionEnabled(input: {
	getDb: RuntimeDbGetter;
	ownerUserId: string;
}): Promise<boolean> {
	const db = await input.getDb();
	const rows = await db
		.select({ profileMemoryEnabled: profileMemorySettings.profileMemoryEnabled })
		.from(profileMemorySettings)
		.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
		.limit(1);
	return rows[0]?.profileMemoryEnabled ?? true;
}

export function createPgProfileMemoryStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): ProfileMemoryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async deleteItem(input) {
			const db = await getDb();
			const deletedRows = await db
				.delete(profileMemoryItems)
				.where(
					and(
						eq(profileMemoryItems.ownerUserId, input.ownerUserId),
						eq(profileMemoryItems.itemId, input.itemId),
					),
				)
				.returning({ itemId: profileMemoryItems.itemId });

			return deletedRows.length > 0;
		},

		async listByOwner(ownerUserId) {
			const db = await getDb();
			const enabled = await isProjectionEnabled({ getDb, ownerUserId });
			const rows = await db
				.select()
				.from(profileMemoryItems)
				.where(eq(profileMemoryItems.ownerUserId, ownerUserId))
				.orderBy(asc(profileMemoryItems.key));

			return {
				enabled,
				items: rows.map(toItem),
			};
		},

		async listProjectionItems(input) {
			const enabled = await isProjectionEnabled({
				getDb,
				ownerUserId: input.ownerUserId,
			});
			if (!enabled) {
				return [];
			}

			const db = await getDb();
			const rows = await db
				.select()
				.from(profileMemoryItems)
				.where(
					and(
						eq(profileMemoryItems.ownerUserId, input.ownerUserId),
						eq(profileMemoryItems.visibility, "user_visible"),
					),
				)
				.orderBy(asc(profileMemoryItems.key));

			return rows.map(toProjectionItem);
		},

		async setEnabled(input) {
			const db = await getDb();
			await db
				.insert(profileMemorySettings)
				.values({
					ownerUserId: input.ownerUserId,
					profileMemoryEnabled: input.enabled,
					updatedAt: new Date(input.updatedAt),
				})
				.onConflictDoUpdate({
					set: {
						profileMemoryEnabled: input.enabled,
						updatedAt: new Date(input.updatedAt),
					},
					target: profileMemorySettings.ownerUserId,
				});
			return input.enabled;
		},

		async upsertUserDeclared(input) {
			const db = await getDb();
			const values = {
				confidence: "low",
				createdAt: new Date(input.updatedAt),
				itemId: input.itemId,
				key: input.key,
				lastVerifiedAt: new Date(input.updatedAt),
				ownerUserId: input.ownerUserId,
				sourceType: "user_declared",
				updatedAt: new Date(input.updatedAt),
				value: input.value,
				visibility: "user_visible",
			};
			const rows = await db
				.insert(profileMemoryItems)
				.values(values)
				.onConflictDoUpdate({
					set: {
						confidence: values.confidence,
						lastVerifiedAt: values.lastVerifiedAt,
						sourceType: values.sourceType,
						updatedAt: values.updatedAt,
						value: values.value,
						visibility: values.visibility,
					},
					target: [profileMemoryItems.ownerUserId, profileMemoryItems.key],
				})
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Profile memory upsert returned no row.");
			}
			return toItem(row);
		},
	};
}
