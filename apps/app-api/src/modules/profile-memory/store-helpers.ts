import { and, desc, eq } from "drizzle-orm";

import { profileMemoryCommands, profileMemoryItems, profileMemorySettings } from "../../db/schema";
import { PROFILE_MEMORY_SUPERSESSION_SCOPE, type ProfileMemoryTransaction } from "./command-state";
import type {
	ProfileMemoryCommand,
	ProfileMemoryCommandKind,
	ProfileMemoryItem,
	ProfileMemoryLifecycleState,
	ProfileMemoryMutationResult,
	ProfileMemorySyncStatus,
} from "./model";
import { profileMemoryItemState, toIsoString } from "./model";
import { type MutationBase, ProfileMemoryStoreConflict } from "./store-contract";
import {
	type CommandRow,
	type ItemRow,
	profileMemoryItemSelection,
	type SettingsRow,
} from "./store-schema";

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

export function toItem(row: ItemRow): ProfileMemoryItem {
	return {
		itemId: row.itemId,
		key: row.key,
		revision: row.revision,
		state: profileMemoryItemState(row),
		updatedAt: toIsoString(row.updatedAt),
		value: row.value,
	};
}

export function toCommand(row: CommandRow, sourceMessageIds: string[] = []): ProfileMemoryCommand {
	return {
		commandId: row.commandId,
		commandKind: row.commandKind as ProfileMemoryCommandKind,
		ownerGeneration: row.ownerGeneration,
		ownerSequence: row.ownerSequence,
		ownerUserId: row.ownerUserId,
		status: row.status as ProfileMemoryCommand["status"],
		subjectId: row.subjectId,
		subjectRevision: row.subjectRevision,
		sourceMessageIds,
		supersessionScope: row.supersessionScope,
	};
}

export function mutationResult(
	settings: SettingsRow,
	item?: ItemRow | null,
): ProfileMemoryMutationResult {
	return {
		...(item ? { item: toItem(item) } : {}),
		lifecycleState: settings.lifecycleState as ProfileMemoryLifecycleState,
		syncStatus: settings.syncStatus as ProfileMemorySyncStatus,
	};
}

export function assertItemMutable(settings: SettingsRow): void {
	if (settings.lifecycleState === "erasing" || settings.lifecycleState === "erased") {
		throw new ProfileMemoryStoreConflict("profile_memory_not_ready");
	}
}

export function assertLifecycleMutable(
	settings: SettingsRow,
	targetLifecycleState: "active" | "paused",
): void {
	if (
		settings.lifecycleState === "erasing" ||
		(settings.lifecycleState === "erased" && targetLifecycleState !== "active")
	) {
		throw new ProfileMemoryStoreConflict("profile_memory_not_ready");
	}
}

export async function readReplay(
	tx: ProfileMemoryTransaction,
	input: MutationBase,
): Promise<CommandRow | null> {
	const rows = await tx
		.select()
		.from(profileMemoryCommands)
		.where(
			and(
				eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
				eq(profileMemoryCommands.idempotencyKeyHash, input.idempotencyKeyHash),
			),
		)
		.limit(1);
	const command = rows[0];
	if (!command) {
		return null;
	}
	if (command.requestFingerprint !== input.requestFingerprint) {
		throw new ProfileMemoryStoreConflict("idempotency_conflict");
	}
	return command;
}

export async function readLatestOwnerErase(
	tx: ProfileMemoryTransaction,
	ownerUserId: string,
	generation: number,
): Promise<CommandRow | null> {
	const rows = await tx
		.select()
		.from(profileMemoryCommands)
		.where(
			and(
				eq(profileMemoryCommands.ownerUserId, ownerUserId),
				eq(profileMemoryCommands.ownerGeneration, generation),
				eq(profileMemoryCommands.commandKind, "owner_erase"),
				eq(
					profileMemoryCommands.supersessionScope,
					PROFILE_MEMORY_SUPERSESSION_SCOPE.erase(generation),
				),
			),
		)
		.orderBy(desc(profileMemoryCommands.ownerSequence))
		.limit(1);
	return rows[0] ?? null;
}

export async function replayResult(
	tx: ProfileMemoryTransaction,
	input: MutationBase,
	command: CommandRow,
	settings: SettingsRow,
): Promise<ProfileMemoryMutationResult> {
	if (!command.subjectId) {
		return mutationResult(settings);
	}
	const rows = await tx
		.select(profileMemoryItemSelection)
		.from(profileMemoryItems)
		.where(
			and(
				eq(profileMemoryItems.ownerUserId, input.ownerUserId),
				eq(profileMemoryItems.itemId, command.subjectId),
			),
		)
		.limit(1);
	return mutationResult(settings, rows[0]);
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
