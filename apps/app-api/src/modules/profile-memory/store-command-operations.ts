import { and, asc, eq, sql } from "drizzle-orm";

import {
	profileMemoryCommandSources,
	profileMemoryCommands,
	profileMemorySettings,
} from "../../db/schema";
import { isCurrentCommandScopeHead, reconcileOwnerMemoryState } from "./command-state";
import type { ProfileMemoryStoreContext } from "./store-context";
import type { ProfileMemoryCommandPayload, ProfileMemoryCommandStore } from "./store-contract";
import { toCommand } from "./store-helpers";
import { profileMemoryItemSelection, profileMemoryItems } from "./store-schema";

export function createProfileMemoryCommandStore(
	context: ProfileMemoryStoreContext,
): ProfileMemoryCommandStore {
	const { getDb } = context;
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
								.select(profileMemoryItemSelection)
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
					lifecycleState:
						command.acceptedLifecycleState as ProfileMemoryCommandPayload["lifecycleState"],
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
	};
}
