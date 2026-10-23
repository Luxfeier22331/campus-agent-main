import { eq } from "drizzle-orm";

import { profileMemorySettings } from "../../db/schema";
import type { ProfileMemoryTransaction } from "./command-state";
import { isProfileMemoryRuntimeEnabled } from "./model";

export interface ProfileMemoryRuntimeSnapshot {
	appendEnabled: boolean;
	ownerGeneration: number;
	recallEnabled: boolean;
}

export async function captureProfileMemorySnapshotForUpdate(
	tx: ProfileMemoryTransaction,
	ownerUserId: string,
): Promise<ProfileMemoryRuntimeSnapshot> {
	const settingsRows = await tx
		.select()
		.from(profileMemorySettings)
		.where(eq(profileMemorySettings.ownerUserId, ownerUserId))
		.limit(1)
		.for("update");
	const settings = settingsRows[0];
	const memoryEnabled = isProfileMemoryRuntimeEnabled({
		lifecycleState: settings?.lifecycleState ?? "active",
		syncStatus: settings?.syncStatus ?? "synced",
	});
	return {
		appendEnabled: memoryEnabled,
		ownerGeneration: settings?.generation ?? 1,
		recallEnabled: memoryEnabled,
	};
}
