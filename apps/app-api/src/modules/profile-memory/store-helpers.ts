import { and, eq } from "drizzle-orm";
import { profileMemoryCommands, profileMemorySettings } from "../../db/schema";
import type { ProfileMemoryTransaction } from "./command-state";
import type {
	ProfileMemoryCommand,
	ProfileMemoryCommandKind,
	ProfileMemoryLifecycleState,
	ProfileMemoryMutationResult,
	ProfileMemorySyncStatus,
} from "./model";
import { type MutationBase, ProfileMemoryStoreConflict } from "./store-contract";
import type { CommandRow, SettingsRow } from "./store-schema";
export function defaultSettings(ownerUserId: string): SettingsRow {
	return {
		commandSequence: 0,
		eraseRequestedAt: null,
		erasedAt: null,
		generation: 1,
		lifecycleState: "active",
		ownerUserId,
		syncStatus: "synced",
		updatedAt: new Date(0),
	};
}
export function toCommand(row: CommandRow): ProfileMemoryCommand {
	return {
		commandId: row.commandId,
		commandKind: row.commandKind as ProfileMemoryCommandKind,
		ownerGeneration: row.ownerGeneration,
		ownerSequence: row.ownerSequence,
		ownerUserId: row.ownerUserId,
		status: row.status as ProfileMemoryCommand["status"],
		subjectId: row.subjectId,
		supersessionScope: row.supersessionScope,
	};
}
export function mutationResult(
	settings: SettingsRow,
	commandId: string,
): ProfileMemoryMutationResult {
	return {
		commandId,
		lifecycleState: settings.lifecycleState as ProfileMemoryLifecycleState,
		syncStatus: settings.syncStatus as ProfileMemorySyncStatus,
	};
}
export async function readReplay(
	tx: ProfileMemoryTransaction,
	input: Pick<MutationBase, "ownerUserId" | "idempotencyKeyHash" | "requestFingerprint">,
): Promise<CommandRow | null> {
	const [command] = await tx
		.select()
		.from(profileMemoryCommands)
		.where(
			and(
				eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
				eq(profileMemoryCommands.idempotencyKeyHash, input.idempotencyKeyHash),
			),
		)
		.limit(1);
	if (command && command.requestFingerprint !== input.requestFingerprint) {
		throw new ProfileMemoryStoreConflict("idempotency_conflict");
	}
	return command ?? null;
}
export async function insertSettingsIfMissing(
	tx: ProfileMemoryTransaction,
	ownerUserId: string,
	updatedAt: Date,
): Promise<void> {
	await tx
		.insert(profileMemorySettings)
		.values({ ownerUserId, updatedAt })
		.onConflictDoNothing({ target: profileMemorySettings.ownerUserId });
}
