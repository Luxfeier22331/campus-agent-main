import { and, eq, inArray, sql } from "drizzle-orm";

import {
	profileMemoryCommandSources,
	profileMemoryCommands,
	profileMemorySettings,
} from "../../db/schema";
import {
	PROFILE_MEMORY_SUPERSESSION_SCOPE,
	reconcileOwnerMemoryState,
	supersedePendingCommandsInScope,
} from "./command-state";
import type { ProfileMemoryCommand } from "./model";
import type { ProfileMemoryStoreContext } from "./store-context";
import { type ProfileMemoryMutationStore, ProfileMemoryStoreConflict } from "./store-contract";
import {
	assertItemMutable,
	assertLifecycleMutable,
	defaultSettings,
	insertSettingsIfMissing,
	mutationResult,
	readLatestOwnerErase,
	readReplay,
	replayResult,
} from "./store-helpers";
import { profileMemoryItemSelection, profileMemoryItems } from "./store-schema";

export function createProfileMemoryMutationStore(
	context: ProfileMemoryStoreContext,
): ProfileMemoryMutationStore {
	const { getDb } = context;
	return {
		async createItem(input) {
			const now = new Date(input.updatedAt);
			const db = await getDb();
			return db.transaction(async (tx) => {
				await insertSettingsIfMissing(tx, input.ownerUserId, now);
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0] ?? defaultSettings(input.ownerUserId);
				const replay = await readReplay(tx, input);
				if (replay) {
					return replayResult(tx, input, replay, settings);
				}
				assertItemMutable(settings);
				const existing = await tx
					.select({ itemId: profileMemoryItems.itemId })
					.from(profileMemoryItems)
					.where(
						and(
							eq(profileMemoryItems.ownerUserId, input.ownerUserId),
							eq(profileMemoryItems.key, input.key),
						),
					)
					.limit(1);
				if (existing[0]) {
					throw new ProfileMemoryStoreConflict("profile_memory_key_conflict");
				}
				const sequence = settings.commandSequence + 1;
				const supersessionScope = PROFILE_MEMORY_SUPERSESSION_SCOPE.item(input.itemId);
				await supersedePendingCommandsInScope(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
					supersessionScope,
				});
				const itemRows = await tx
					.insert(profileMemoryItems)
					.values({
						createdAt: now,
						desiredState: "present",
						itemId: input.itemId,
						key: input.key,
						ownerGeneration: settings.generation,
						ownerUserId: input.ownerUserId,
						revision: 1,
						syncStatus: "pending",
						updatedAt: now,
						value: input.value,
					})
					.returning(profileMemoryItemSelection);
				await tx.insert(profileMemoryCommands).values({
					acceptedItemKey: input.key,
					acceptedItemValue: input.value,
					acceptedLifecycleState: settings.lifecycleState,
					commandId: input.commandId,
					commandKind: "item_upsert",
					createdAt: now,
					idempotencyKeyHash: input.idempotencyKeyHash,
					ownerGeneration: settings.generation,
					ownerSequence: sequence,
					ownerUserId: input.ownerUserId,
					requestFingerprint: input.requestFingerprint,
					status: "pending_admission",
					subjectId: input.itemId,
					subjectRevision: 1,
					sourceUpdatedAt: now,
					supersessionScope,
					updatedAt: now,
				});
				await tx
					.update(profileMemorySettings)
					.set({ commandSequence: sequence, updatedAt: now })
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
				const syncStatus = await reconcileOwnerMemoryState(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
				});
				return mutationResult(
					{ ...settings, commandSequence: sequence, syncStatus, updatedAt: now },
					itemRows[0],
				);
			});
		},

		async deleteItem(input) {
			const now = new Date(input.updatedAt);
			const db = await getDb();
			return db.transaction(async (tx) => {
				await insertSettingsIfMissing(tx, input.ownerUserId, now);
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0] ?? defaultSettings(input.ownerUserId);
				const replay = await readReplay(tx, input);
				if (replay) {
					return replayResult(tx, input, replay, settings);
				}
				assertItemMutable(settings);
				const itemRows = await tx
					.select(profileMemoryItemSelection)
					.from(profileMemoryItems)
					.where(
						and(
							eq(profileMemoryItems.ownerUserId, input.ownerUserId),
							eq(profileMemoryItems.itemId, input.itemId),
						),
					)
					.limit(1)
					.for("update");
				const item = itemRows[0];
				if (!item) {
					return null;
				}
				const revision = item.revision + 1;
				const sequence = settings.commandSequence + 1;
				const supersessionScope = PROFILE_MEMORY_SUPERSESSION_SCOPE.item(item.itemId);
				await supersedePendingCommandsInScope(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
					supersessionScope,
				});
				const updatedItems = await tx
					.update(profileMemoryItems)
					.set({
						desiredState: "deleted",
						revision,
						syncErrorCode: null,
						syncStatus: "pending",
						updatedAt: now,
					})
					.where(eq(profileMemoryItems.itemId, item.itemId))
					.returning(profileMemoryItemSelection);
				await tx.insert(profileMemoryCommands).values({
					acceptedLifecycleState: settings.lifecycleState,
					commandId: input.commandId,
					commandKind: "item_delete",
					createdAt: now,
					idempotencyKeyHash: input.idempotencyKeyHash,
					ownerGeneration: settings.generation,
					ownerSequence: sequence,
					ownerUserId: input.ownerUserId,
					requestFingerprint: input.requestFingerprint,
					status: "pending_admission",
					subjectId: item.itemId,
					subjectRevision: revision,
					sourceUpdatedAt: now,
					supersessionScope,
					updatedAt: now,
				});
				await tx
					.update(profileMemorySettings)
					.set({ commandSequence: sequence, updatedAt: now })
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
				const syncStatus = await reconcileOwnerMemoryState(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
				});
				return mutationResult(
					{ ...settings, commandSequence: sequence, syncStatus, updatedAt: now },
					updatedItems[0],
				);
			});
		},

		async erase(input) {
			const now = new Date(input.updatedAt);
			const db = await getDb();
			return db.transaction(async (tx) => {
				await insertSettingsIfMissing(tx, input.ownerUserId, now);
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0] ?? defaultSettings(input.ownerUserId);
				const replay = await readReplay(tx, input);
				if (replay) {
					return replayResult(tx, input, replay, settings);
				}
				const latestErase = await readLatestOwnerErase(tx, input.ownerUserId, settings.generation);
				if (
					settings.lifecycleState === "erased" ||
					(settings.lifecycleState === "erasing" &&
						latestErase !== null &&
						(latestErase.status === "pending_admission" || latestErase.status === "admitted"))
				) {
					return mutationResult(settings);
				}
				const generation =
					settings.lifecycleState === "erasing" ? settings.generation : settings.generation + 1;
				const sequence = settings.commandSequence + 1;
				await tx
					.update(profileMemoryItems)
					.set({ desiredState: "deleted", syncStatus: "pending", value: "", updatedAt: now })
					.where(eq(profileMemoryItems.ownerUserId, input.ownerUserId));
				await tx
					.update(profileMemoryCommands)
					.set({
						acceptedItemKey: null,
						acceptedItemValue: null,
						processedAt: now,
						status: "superseded",
						updatedAt: now,
					})
					.where(
						and(
							eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
							inArray(profileMemoryCommands.status, ["pending_admission"]),
						),
					);
				await tx
					.update(profileMemoryCommands)
					.set({ acceptedItemKey: null, acceptedItemValue: null })
					.where(eq(profileMemoryCommands.ownerUserId, input.ownerUserId));
				await tx.delete(profileMemoryCommandSources).where(
					sql`${profileMemoryCommandSources.commandId} in (
						select command_id
						from profile.memory_commands
						where owner_user_id = ${input.ownerUserId}
					)`,
				);
				await tx.insert(profileMemoryCommands).values({
					acceptedLifecycleState: "erasing",
					commandId: input.commandId,
					commandKind: "owner_erase",
					createdAt: now,
					idempotencyKeyHash: input.idempotencyKeyHash,
					ownerGeneration: generation,
					ownerSequence: sequence,
					ownerUserId: input.ownerUserId,
					requestFingerprint: input.requestFingerprint,
					sourceUpdatedAt: now,
					status: "pending_admission",
					supersessionScope: PROFILE_MEMORY_SUPERSESSION_SCOPE.erase(generation),
					updatedAt: now,
				});
				await tx
					.update(profileMemorySettings)
					.set({
						commandSequence: sequence,
						eraseRequestedAt: now,
						erasedAt: null,
						generation,
						lifecycleState: "erasing",
						updatedAt: now,
					})
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
				const syncStatus = await reconcileOwnerMemoryState(tx, {
					generation,
					now,
					ownerUserId: input.ownerUserId,
				});
				return mutationResult({
					...settings,
					commandSequence: sequence,
					eraseRequestedAt: now,
					erasedAt: null,
					generation,
					lifecycleState: "erasing",
					syncStatus,
					updatedAt: now,
				});
			});
		},

		async findCommandByIdempotency(input) {
			const db = await getDb();
			const rows = await db
				.select({
					commandId: profileMemoryCommands.commandId,
					requestFingerprint: profileMemoryCommands.requestFingerprint,
					status: profileMemoryCommands.status,
				})
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
			return {
				commandId: command.commandId,
				status: command.status as ProfileMemoryCommand["status"],
			};
		},

		async setLifecycle(input) {
			const now = new Date(input.updatedAt);
			const db = await getDb();
			return db.transaction(async (tx) => {
				await insertSettingsIfMissing(tx, input.ownerUserId, now);
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0] ?? defaultSettings(input.ownerUserId);
				const replay = await readReplay(tx, input);
				if (replay) {
					return replayResult(tx, input, replay, settings);
				}
				assertLifecycleMutable(settings, input.lifecycleState);
				const sequence = settings.commandSequence + 1;
				await supersedePendingCommandsInScope(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
					supersessionScope: PROFILE_MEMORY_SUPERSESSION_SCOPE.lifecycle,
				});
				await tx.insert(profileMemoryCommands).values({
					acceptedLifecycleState: input.lifecycleState,
					commandId: input.commandId,
					commandKind: "owner_transition",
					createdAt: now,
					idempotencyKeyHash: input.idempotencyKeyHash,
					ownerGeneration: settings.generation,
					ownerSequence: sequence,
					ownerUserId: input.ownerUserId,
					requestFingerprint: input.requestFingerprint,
					status: "pending_admission",
					subjectId: input.lifecycleState,
					sourceUpdatedAt: now,
					supersessionScope: PROFILE_MEMORY_SUPERSESSION_SCOPE.lifecycle,
					updatedAt: now,
				});
				await tx
					.update(profileMemorySettings)
					.set({
						commandSequence: sequence,
						lifecycleState: input.lifecycleState,
						updatedAt: now,
					})
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
				const syncStatus = await reconcileOwnerMemoryState(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
				});
				return mutationResult({
					...settings,
					commandSequence: sequence,
					lifecycleState: input.lifecycleState,
					syncStatus,
					updatedAt: now,
				});
			});
		},

		async updateItem(input) {
			const now = new Date(input.updatedAt);
			const db = await getDb();
			return db.transaction(async (tx) => {
				await insertSettingsIfMissing(tx, input.ownerUserId, now);
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0] ?? defaultSettings(input.ownerUserId);
				const replay = await readReplay(tx, input);
				if (replay) {
					return replayResult(tx, input, replay, settings);
				}
				assertItemMutable(settings);
				const itemRows = await tx
					.select(profileMemoryItemSelection)
					.from(profileMemoryItems)
					.where(
						and(
							eq(profileMemoryItems.ownerUserId, input.ownerUserId),
							eq(profileMemoryItems.itemId, input.itemId),
						),
					)
					.limit(1)
					.for("update");
				const item = itemRows[0];
				if (!item) {
					return null;
				}
				const conflicting = await tx
					.select({ itemId: profileMemoryItems.itemId })
					.from(profileMemoryItems)
					.where(
						and(
							eq(profileMemoryItems.ownerUserId, input.ownerUserId),
							eq(profileMemoryItems.key, input.key),
						),
					)
					.limit(1);
				if (conflicting[0] && conflicting[0].itemId !== input.itemId) {
					throw new ProfileMemoryStoreConflict("profile_memory_key_conflict");
				}
				const revision = item.revision + 1;
				const sequence = settings.commandSequence + 1;
				const supersessionScope = PROFILE_MEMORY_SUPERSESSION_SCOPE.item(item.itemId);
				await supersedePendingCommandsInScope(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
					supersessionScope,
				});
				const updatedItems = await tx
					.update(profileMemoryItems)
					.set({
						desiredState: "present",
						key: input.key,
						revision,
						syncErrorCode: null,
						syncStatus: "pending",
						updatedAt: now,
						value: input.value,
					})
					.where(eq(profileMemoryItems.itemId, item.itemId))
					.returning(profileMemoryItemSelection);
				await tx.insert(profileMemoryCommands).values({
					acceptedItemKey: input.key,
					acceptedItemValue: input.value,
					acceptedLifecycleState: settings.lifecycleState,
					commandId: input.commandId,
					commandKind: "item_upsert",
					createdAt: now,
					idempotencyKeyHash: input.idempotencyKeyHash,
					ownerGeneration: settings.generation,
					ownerSequence: sequence,
					ownerUserId: input.ownerUserId,
					requestFingerprint: input.requestFingerprint,
					status: "pending_admission",
					subjectId: item.itemId,
					subjectRevision: revision,
					sourceUpdatedAt: now,
					supersessionScope,
					updatedAt: now,
				});
				await tx
					.update(profileMemorySettings)
					.set({ commandSequence: sequence, updatedAt: now })
					.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
				const syncStatus = await reconcileOwnerMemoryState(tx, {
					generation: settings.generation,
					now,
					ownerUserId: input.ownerUserId,
				});
				return mutationResult(
					{ ...settings, commandSequence: sequence, syncStatus, updatedAt: now },
					updatedItems[0],
				);
			});
		},
	};
}
