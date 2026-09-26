import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { profileMemoryCommands, profileMemorySettings } from "../../db/schema";
import type {
	ProfileMemoryLifecycleState,
	ProfileMemoryOperation,
	ProfileMemorySyncStatus,
} from "./model";
import type { ProfileMemoryStoreContext } from "./store-context";
import type { ProfileMemoryReadStore } from "./store-contract";
import { defaultSettings } from "./store-helpers";
export function createProfileMemoryReadStore({
	getDb,
}: ProfileMemoryStoreContext): ProfileMemoryReadStore {
	return {
		async generationByOwner(ownerUserId) {
			const db = await getDb();
			const [settings] = await db
				.select({ generation: profileMemorySettings.generation })
				.from(profileMemorySettings)
				.where(eq(profileMemorySettings.ownerUserId, ownerUserId));
			return settings?.generation ?? 1;
		},
		async listByOwner(ownerUserId) {
			const db = await getDb();
			const [settingsRows, commands] = await Promise.all([
				db
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, ownerUserId)),
				db
					.select()
					.from(profileMemoryCommands)
					.where(
						and(
							eq(profileMemoryCommands.ownerUserId, ownerUserId),
							inArray(profileMemoryCommands.status, ["pending_admission", "admitted", "failed"]),
							sql`(${profileMemoryCommands.status} <> 'failed' or not exists (select 1 from profile.memory_commands later
            where later.owner_user_id = ${profileMemoryCommands.ownerUserId}
              and later.supersession_scope = ${profileMemoryCommands.supersessionScope}
              and later.owner_sequence > ${profileMemoryCommands.ownerSequence}))`,
						),
					)
					.orderBy(desc(profileMemoryCommands.ownerSequence))
					.limit(100),
			]);
			const settings = settingsRows[0] ?? defaultSettings(ownerUserId);
			return {
				lifecycleState: settings.lifecycleState as ProfileMemoryLifecycleState,
				syncStatus: settings.syncStatus as ProfileMemorySyncStatus,
				operations: commands
					.filter((command) => command.ownerGeneration === settings.generation)
					.map((command) => ({
						commandId: command.commandId,
						commandKind: command.commandKind as ProfileMemoryOperation["commandKind"],
						status: command.status as ProfileMemoryOperation["status"],
						errorCode: command.lastErrorCode,
					})),
			};
		},
	};
}
