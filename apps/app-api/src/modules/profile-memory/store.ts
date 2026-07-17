import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDbGetter } from "../../db/runtime";
import {
	profileMemoryCommandSources,
	profileMemoryCommands,
	profileMemoryItems,
	profileMemorySettings,
} from "../../db/schema";
import {
	isCurrentCommandScopeHead,
	PROFILE_MEMORY_SUPERSESSION_SCOPE,
	type ProfileMemoryTransaction,
	reconcileOwnerMemoryState,
	supersedePendingCommandsInScope,
} from "./command-state";
import type {
	ProfileMemoryCommand,
	ProfileMemoryCommandKind,
	ProfileMemoryItem,
	ProfileMemoryLifecycleState,
	ProfileMemoryList,
	ProfileMemoryMutationResult,
	ProfileMemoryProjectionItem,
	ProfileMemorySummary,
	ProfileMemorySyncStatus,
} from "./model";
import { profileMemoryItemState, toIsoString } from "./model";

export class ProfileMemoryStoreConflict extends Error {
	readonly code:
		| "idempotency_conflict"
		| "profile_memory_key_conflict"
		| "profile_memory_not_ready";

	constructor(
		code: "idempotency_conflict" | "profile_memory_key_conflict" | "profile_memory_not_ready",
	) {
		super(code);
		this.code = code;
		this.name = "ProfileMemoryStoreConflict";
	}
}

export interface ProfileMemoryCommandPayload extends ProfileMemoryCommand {
	item: { key: string; value: string } | null;
	lifecycleState: ProfileMemoryLifecycleState;
	schemaVersion: "personal_memory_command.v2";
	sourceUpdatedAt: string;
}

interface MutationBase {
	commandId: string;
	idempotencyKeyHash: string;
	ownerUserId: string;
	requestFingerprint: string;
	updatedAt: string;
}

export interface ProfileMemoryStore {
	applyCommandResult(input: {
		commandId: string;
		errorCode?: string;
		resultFingerprint: string;
		status: "succeeded" | "failed";
		updatedAt: string;
	}): Promise<"applied" | "conflict" | "not_found" | "replayed" | "superseded">;
	createItem(
		input: MutationBase & {
			itemId: string;
			key: string;
			value: string;
		},
	): Promise<ProfileMemoryMutationResult>;
	deleteItem(input: MutationBase & { itemId: string }): Promise<ProfileMemoryMutationResult | null>;
	erase(input: MutationBase): Promise<ProfileMemoryMutationResult>;
	listPendingAdmissions(input: { limit: number }): Promise<ProfileMemoryCommandPayload[]>;
	markCommandAdmitted(input: {
		admittedAt: string;
		commandId: string;
		workflowId: string;
	}): Promise<boolean>;
	listByOwner(ownerUserId: string): Promise<ProfileMemoryList>;
	listProjectionItems(input: { ownerUserId: string }): Promise<ProfileMemoryProjectionItem[]>;
	loadSummary(input: { ownerUserId: string }): Promise<ProfileMemorySummary>;
	setLifecycle(
		input: MutationBase & {
			lifecycleState: "active" | "paused";
		},
	): Promise<ProfileMemoryMutationResult>;
	updateItem(
		input: MutationBase & {
			itemId: string;
			key: string;
			value: string;
		},
	): Promise<ProfileMemoryMutationResult | null>;
}

export type ProfileMemoryProjectionStore = Pick<ProfileMemoryStore, "listProjectionItems">;

type SettingsRow = typeof profileMemorySettings.$inferSelect;
type ItemRow = typeof profileMemoryItems.$inferSelect;
type CommandRow = typeof profileMemoryCommands.$inferSelect;

function defaultSettings(ownerUserId: string): SettingsRow {
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

function toItem(row: ItemRow): ProfileMemoryItem {
	return {
		itemId: row.itemId,
		key: row.key,
		revision: row.revision,
		state: profileMemoryItemState(row),
		updatedAt: toIsoString(row.updatedAt),
		value: row.value,
	};
}

function toProjectionItem(row: ItemRow): ProfileMemoryProjectionItem {
	return {
		confidence: row.confidence as ProfileMemoryProjectionItem["confidence"],
		itemId: row.itemId,
		key: row.key,
		lastVerifiedAt: toIsoString(row.lastVerifiedAt),
		sourceType: row.sourceType as ProfileMemoryProjectionItem["sourceType"],
		value: row.value,
		visibility: row.visibility as ProfileMemoryProjectionItem["visibility"],
	};
}

function toCommand(row: CommandRow, sourceMessageIds: string[] = []): ProfileMemoryCommand {
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

function mutationResult(settings: SettingsRow, item?: ItemRow | null): ProfileMemoryMutationResult {
	return {
		...(item ? { item: toItem(item) } : {}),
		lifecycleState: settings.lifecycleState as ProfileMemoryLifecycleState,
		syncStatus: settings.syncStatus as ProfileMemorySyncStatus,
	};
}

function assertItemMutable(settings: SettingsRow): void {
	if (settings.lifecycleState === "erasing" || settings.lifecycleState === "erased") {
		throw new ProfileMemoryStoreConflict("profile_memory_not_ready");
	}
}

function assertLifecycleMutable(
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

export function createPgProfileMemoryStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): ProfileMemoryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env, { consistency: "fresh" });

	async function readSettings(ownerUserId: string): Promise<SettingsRow> {
		const db = await getDb();
		const rows = await db
			.select()
			.from(profileMemorySettings)
			.where(eq(profileMemorySettings.ownerUserId, ownerUserId))
			.limit(1);
		return rows[0] ?? defaultSettings(ownerUserId);
	}

	async function readReplay(
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

	async function replayResult(
		tx: ProfileMemoryTransaction,
		input: MutationBase,
		command: CommandRow,
		settings: SettingsRow,
	) {
		if (!command.subjectId) {
			return mutationResult(settings);
		}
		const rows = await tx
			.select()
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

	async function insertSettingsIfMissing(
		tx: ProfileMemoryTransaction,
		ownerUserId: string,
		updatedAt: Date,
	) {
		await tx
			.insert(profileMemorySettings)
			.values({ ownerUserId, updatedAt })
			.onConflictDoNothing({ target: profileMemorySettings.ownerUserId });
	}

	return {
		async applyCommandResult(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const identityRows = await tx
					.select({ ownerUserId: profileMemoryCommands.ownerUserId })
					.from(profileMemoryCommands)
					.where(eq(profileMemoryCommands.commandId, input.commandId))
					.limit(1);
				const identity = identityRows[0];
				if (!identity) {
					return "not_found";
				}
				const now = new Date(input.updatedAt);
				const settingsRows = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, identity.ownerUserId))
					.limit(1)
					.for("update");
				const settings = settingsRows[0];
				const commands = await tx
					.select()
					.from(profileMemoryCommands)
					.where(
						and(
							eq(profileMemoryCommands.commandId, input.commandId),
							eq(profileMemoryCommands.ownerUserId, identity.ownerUserId),
						),
					)
					.limit(1)
					.for("update");
				const command = commands[0];
				if (!command) {
					return "not_found";
				}
				if (command.reportedResultStatus) {
					return command.resultFingerprint === input.resultFingerprint &&
						command.reportedResultStatus === input.status &&
						(command.lastErrorCode ?? "") === (input.errorCode ?? "")
						? "replayed"
						: "conflict";
				}
				if (command.resultFingerprint !== null) {
					return command.resultFingerprint === input.resultFingerprint ? "replayed" : "conflict";
				}
				const isCurrentScopeHead = await isCurrentCommandScopeHead(tx, command);
				let fenceMatches =
					command.status !== "superseded" &&
					Boolean(settings) &&
					settings?.generation === command.ownerGeneration &&
					isCurrentScopeHead;
				if (
					fenceMatches &&
					(command.commandKind === "item_upsert" || command.commandKind === "item_delete")
				) {
					const subjectRows = command.subjectId
						? await tx
								.select()
								.from(profileMemoryItems)
								.where(
									and(
										eq(profileMemoryItems.ownerUserId, command.ownerUserId),
										eq(profileMemoryItems.itemId, command.subjectId),
									),
								)
								.limit(1)
						: [];
					const subject = subjectRows[0];
					fenceMatches = Boolean(
						command.subjectId &&
							subject &&
							subject.ownerGeneration === command.ownerGeneration &&
							subject.revision === command.subjectRevision,
					);
				}
				const appliedStatus = fenceMatches ? input.status : "superseded";
				await tx
					.update(profileMemoryCommands)
					.set({
						acceptedItemKey: null,
						acceptedItemValue: null,
						lastErrorCode: input.errorCode ?? null,
						processedAt: now,
						reportedResultStatus: input.status,
						resultFingerprint: input.resultFingerprint,
						status: appliedStatus,
						updatedAt: now,
					})
					.where(eq(profileMemoryCommands.commandId, command.commandId));
				await tx
					.delete(profileMemoryCommandSources)
					.where(eq(profileMemoryCommandSources.commandId, command.commandId));
				if (
					appliedStatus === "succeeded" &&
					command.commandKind === "item_delete" &&
					command.subjectId
				) {
					await tx
						.delete(profileMemoryItems)
						.where(
							and(
								eq(profileMemoryItems.itemId, command.subjectId),
								eq(profileMemoryItems.revision, command.subjectRevision ?? 0),
							),
						);
				}
				if (appliedStatus === "succeeded" && command.commandKind === "owner_erase") {
					await tx
						.delete(profileMemoryItems)
						.where(eq(profileMemoryItems.ownerUserId, command.ownerUserId));
				}
				if (settings) {
					await reconcileOwnerMemoryState(tx, {
						generation: settings.generation,
						now,
						ownerUserId: command.ownerUserId,
					});
				}
				return fenceMatches ? "applied" : "superseded";
			});
		},

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
						confidence: "low",
						createdAt: now,
						desiredState: "present",
						itemId: input.itemId,
						key: input.key,
						lastVerifiedAt: now,
						ownerGeneration: settings.generation,
						ownerUserId: input.ownerUserId,
						revision: 1,
						sourceType: "user_declared",
						syncStatus: "pending",
						updatedAt: now,
						value: input.value,
						visibility: "user_visible",
					})
					.returning();
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
					.select()
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
					.returning();
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

		async listPendingAdmissions(input) {
			const db = await getDb();
			const commands = await db
				.select()
				.from(profileMemoryCommands)
				.where(
					and(
						eq(profileMemoryCommands.status, "pending_admission"),
						sql`not exists (
							select 1
							from profile.memory_commands earlier
							where earlier.owner_user_id = ${profileMemoryCommands.ownerUserId}
								and earlier.owner_sequence < ${profileMemoryCommands.ownerSequence}
								and earlier.status in ('pending_admission', 'admitted')
						)`,
					),
				)
				.orderBy(asc(profileMemoryCommands.createdAt), asc(profileMemoryCommands.commandId))
				.limit(Math.max(1, input.limit));
			const payloads: ProfileMemoryCommandPayload[] = [];
			for (const command of commands) {
				const sourceRows = await db
					.select({ sourceMessageId: profileMemoryCommandSources.sourceMessageId })
					.from(profileMemoryCommandSources)
					.where(eq(profileMemoryCommandSources.commandId, command.commandId))
					.orderBy(asc(profileMemoryCommandSources.sourceMessageId));
				payloads.push({
					...toCommand(
						command,
						sourceRows.map((row) => row.sourceMessageId),
					),
					item:
						command.acceptedItemKey !== null && command.acceptedItemValue !== null
							? { key: command.acceptedItemKey, value: command.acceptedItemValue }
							: null,
					lifecycleState: command.acceptedLifecycleState as ProfileMemoryLifecycleState,
					schemaVersion: "personal_memory_command.v2",
					sourceUpdatedAt: command.sourceUpdatedAt.toISOString(),
				});
			}
			return payloads;
		},

		async markCommandAdmitted(input) {
			const db = await getDb();
			const rows = await db
				.update(profileMemoryCommands)
				.set({
					admittedAt: new Date(input.admittedAt),
					status: "admitted",
					updatedAt: new Date(input.admittedAt),
					workflowId: input.workflowId,
				})
				.where(
					and(
						eq(profileMemoryCommands.commandId, input.commandId),
						eq(profileMemoryCommands.status, "pending_admission"),
					),
				)
				.returning({ commandId: profileMemoryCommands.commandId });
			return rows.length === 1;
		},

		async listByOwner(ownerUserId) {
			const settings = await readSettings(ownerUserId);
			const db = await getDb();
			const rows = await db
				.select()
				.from(profileMemoryItems)
				.where(
					and(
						eq(profileMemoryItems.ownerUserId, ownerUserId),
						eq(profileMemoryItems.visibility, "user_visible"),
						eq(profileMemoryItems.sourceType, "user_declared"),
					),
				)
				.orderBy(asc(profileMemoryItems.key));
			return {
				itemCount: rows.filter((row) => row.desiredState === "present").length,
				items: rows.map(toItem),
				lifecycleState: settings.lifecycleState as ProfileMemoryLifecycleState,
				syncStatus: settings.syncStatus as ProfileMemorySyncStatus,
			};
		},

		async listProjectionItems(input) {
			const settings = await readSettings(input.ownerUserId);
			if (settings.lifecycleState !== "active" || settings.syncStatus !== "synced") {
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
						eq(profileMemoryItems.desiredState, "present"),
						eq(profileMemoryItems.syncStatus, "synced"),
					),
				)
				.orderBy(asc(profileMemoryItems.key));
			return rows.map(toProjectionItem);
		},

		async loadSummary(input) {
			const [list, settings] = await Promise.all([
				this.listByOwner(input.ownerUserId),
				readSettings(input.ownerUserId),
			]);
			return {
				commandSequence: settings.commandSequence,
				enabled: list.lifecycleState === "active" && list.syncStatus === "synced",
				generation: settings.generation,
				itemCount: list.itemCount,
				lifecycleState: list.lifecycleState,
				syncStatus: list.syncStatus,
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
					.select()
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
					.returning();
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
