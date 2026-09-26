import { and, asc, eq, sql } from "drizzle-orm";
import { profileMemoryCommands, profileMemorySettings } from "../../db/schema";
import { reconcileOwnerMemoryState } from "./command-state";
import type { ProfileMemoryEdit, ProfileMemoryLifecycleState } from "./model";
import type { ProfileMemoryStoreContext } from "./store-context";
import type { ProfileMemoryCommandStore } from "./store-contract";
import { toCommand } from "./store-helpers";
export function createProfileMemoryCommandStore({
	getDb,
}: ProfileMemoryStoreContext): ProfileMemoryCommandStore {
	return {
		async applyCommandResult(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const [identity] = await tx
					.select({ ownerUserId: profileMemoryCommands.ownerUserId })
					.from(profileMemoryCommands)
					.where(eq(profileMemoryCommands.commandId, input.commandId));
				if (!identity) {
					return "not_found";
				}
				const [settings] = await tx
					.select()
					.from(profileMemorySettings)
					.where(eq(profileMemorySettings.ownerUserId, identity.ownerUserId))
					.for("update");
				const [command] = await tx
					.select()
					.from(profileMemoryCommands)
					.where(eq(profileMemoryCommands.commandId, input.commandId))
					.for("update");
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
				const current =
					command.status !== "superseded" && settings?.generation === command.ownerGeneration;
				const now = new Date(input.updatedAt);
				await tx
					.update(profileMemoryCommands)
					.set({
						status: current ? input.status : "superseded",
						reportedResultStatus: input.status,
						resultFingerprint: input.resultFingerprint,
						lastErrorCode: input.errorCode ?? null,
						payload: input.status === "succeeded" || !current ? null : command.payload,
						processedAt: now,
						updatedAt: now,
					})
					.where(eq(profileMemoryCommands.commandId, input.commandId));
				if (settings) {
					await reconcileOwnerMemoryState(tx, {
						ownerUserId: identity.ownerUserId,
						generation: settings.generation,
						now,
					});
				}
				return current ? "applied" : "superseded";
			});
		},
		async listPendingAdmissions({ limit }) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(profileMemoryCommands)
				.where(
					and(
						eq(profileMemoryCommands.status, "pending_admission"),
						sql`${profileMemoryCommands.commandKind} = 'owner_erase' or not exists (select 1 from profile.memory_commands earlier
          where earlier.owner_user_id = ${profileMemoryCommands.ownerUserId}
          and earlier.owner_sequence < ${profileMemoryCommands.ownerSequence}
          and earlier.status in ('pending_admission','admitted'))`,
					),
				)
				.orderBy(asc(profileMemoryCommands.createdAt), asc(profileMemoryCommands.commandId))
				.limit(Math.max(1, limit));
			return rows.map((row) => ({
				...toCommand(row),
				item: row.payload as ProfileMemoryEdit | null,
				lifecycleState: row.acceptedLifecycleState as ProfileMemoryLifecycleState,
				schemaVersion: "personal_memory_command.v3" as const,
				sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
			}));
		},
		async listFailedLifecycleCommands({ limit }) {
			const db = await getDb();
			// Failed lifecycle heads only: the failed command is still the newest
			// row of its supersession scope at the current generation, and the
			// settings row agrees it is the blocking head.
			const rows = await db
				.select({
					commandId: profileMemoryCommands.commandId,
					ownerUserId: profileMemoryCommands.ownerUserId,
				})
				.from(profileMemoryCommands)
				.innerJoin(
					profileMemorySettings,
					eq(profileMemorySettings.ownerUserId, profileMemoryCommands.ownerUserId),
				)
				.where(
					and(
						eq(profileMemoryCommands.status, "failed"),
						sql`${profileMemoryCommands.commandKind} in ('owner_erase', 'owner_transition')`,
						eq(profileMemoryCommands.ownerGeneration, profileMemorySettings.generation),
						eq(profileMemorySettings.syncStatus, "failed"),
						sql`not exists (select 1 from profile.memory_commands later
          where later.owner_user_id = ${profileMemoryCommands.ownerUserId}
          and later.owner_sequence > ${profileMemoryCommands.ownerSequence}
          and later.supersession_scope = ${profileMemoryCommands.supersessionScope})`,
					),
				)
				.orderBy(asc(profileMemoryCommands.createdAt), asc(profileMemoryCommands.commandId))
				.limit(Math.max(1, limit));
			return rows;
		},
		async listAdmittedCommands({ limit }) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(profileMemoryCommands)
				.where(eq(profileMemoryCommands.status, "admitted"))
				.orderBy(asc(profileMemoryCommands.updatedAt), asc(profileMemoryCommands.commandId))
				.limit(Math.max(1, limit));
			return rows.map((row) => ({
				...toCommand(row),
				item: row.payload as ProfileMemoryEdit | null,
				lifecycleState: row.acceptedLifecycleState as ProfileMemoryLifecycleState,
				schemaVersion: "personal_memory_command.v3" as const,
				sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
			}));
		},
		async markCommandAdmitted(input) {
			const db = await getDb();
			const rows = await db
				.update(profileMemoryCommands)
				.set({
					admittedAt: new Date(input.admittedAt),
					status: "admitted",
					lastErrorCode: null,
					updatedAt: new Date(input.admittedAt),
				})
				.where(
					and(
						eq(profileMemoryCommands.commandId, input.commandId),
						eq(profileMemoryCommands.status, "pending_admission"),
					),
				)
				.returning({ id: profileMemoryCommands.commandId });
			return rows.length === 1;
		},
		async markAdmissionFailed(input) {
			const db = await getDb();
			await db
				.update(profileMemoryCommands)
				.set({ lastErrorCode: input.errorCode, updatedAt: new Date(input.updatedAt) })
				.where(
					and(
						eq(profileMemoryCommands.commandId, input.commandId),
						eq(profileMemoryCommands.status, "pending_admission"),
					),
				);
		},
	};
}
