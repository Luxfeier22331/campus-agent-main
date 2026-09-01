import { asc, eq } from "drizzle-orm";

import { profileMemoryItems, profileMemorySettings } from "../../db/schema";
import type { ProfileMemoryStoreContext } from "./store-context";
import type {
	ProfileMemoryLifecycleState,
	ProfileMemoryReadStore,
	ProfileMemorySyncStatus,
} from "./store-contract";
import { defaultSettings, toItem } from "./store-helpers";
import { profileMemoryItemSelection } from "./store-schema";

export function createProfileMemoryReadStore(
	context: ProfileMemoryStoreContext,
): ProfileMemoryReadStore {
	const { getDb } = context;
	return {
		async listByOwner(ownerUserId) {
			const db = await getDb();
			const [settingsRows, rows] = await Promise.all([
				db
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, ownerUserId))
					.limit(1),
				db
					.select(profileMemoryItemSelection)
					.from(profileMemoryItems)
					.where(eq(profileMemoryItems.ownerUserId, ownerUserId))
					.orderBy(asc(profileMemoryItems.key)),
			]);
			const settings = settingsRows[0] ?? defaultSettings(ownerUserId);
			return {
				itemCount: rows.filter((row) => row.desiredState === "present").length,
				items: rows.map(toItem),
				lifecycleState: settings.lifecycleState as ProfileMemoryLifecycleState,
				syncStatus: settings.syncStatus as ProfileMemorySyncStatus,
			};
		},
	};
}
