import { and, desc, eq } from "drizzle-orm";
import { profileMemoryCommands, profileMemorySettings } from "../../db/schema";
import { reconcileOwnerMemoryState } from "./command-state";
import type { ProfileMemoryCommandKind, ProfileMemoryEdit } from "./model";
import type { ProfileMemoryStoreContext } from "./store-context";
import {
	type MutationBase,
	type ProfileMemoryMutationStore,
	ProfileMemoryStoreConflict,
} from "./store-contract";
import {
	defaultSettings,
	insertSettingsIfMissing,
	mutationResult,
	readReplay,
	toCommand,
} from "./store-helpers";
export function createProfileMemoryMutationStore({
	getDb,
}: ProfileMemoryStoreContext): ProfileMemoryMutationStore {
	async function enqueue(
		input: MutationBase,
		requestedKind: ProfileMemoryCommandKind,
		requestedItem: ProfileMemoryEdit | null,
		requestedSubjectId: string | null,
		requestedLifecycle?: "active" | "paused",
		failedCommandId?: string,
	) {
		let kind = requestedKind;
		let item = requestedItem;
		let subjectId = requestedSubjectId;
		let targetLifecycle = requestedLifecycle;
		const db = await getDb();
		const now = new Date(input.updatedAt);
		return db.transaction(async (tx) => {
			await insertSettingsIfMissing(tx, input.ownerUserId, now);
			const [stored] = await tx
				.select()
				.from(profileMemorySettings)
				.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
				.limit(1)
				.for("update");
			let settings = stored ?? defaultSettings(input.ownerUserId);
			const replay = await readReplay(tx, input);
			if (replay) {
				return mutationResult(settings, replay.commandId);
			}
			if (failedCommandId) {
				const [failed] = await tx
					.select()
					.from(profileMemoryCommands)
					.where(
						and(
							eq(profileMemoryCommands.commandId, failedCommandId),
							eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
							eq(profileMemoryCommands.ownerGeneration, settings.generation),
							eq(profileMemoryCommands.status, "failed"),
						),
					)
					.limit(1);
				if (!failed) {
					throw new ProfileMemoryStoreConflict("profile_memory_not_ready");
				}
				const [head] = await tx
					.select()
					.from(profileMemoryCommands)
					.where(
						and(
							eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
							eq(profileMemoryCommands.supersessionScope, failed.supersessionScope),
						),
					)
					.orderBy(desc(profileMemoryCommands.ownerSequence))
					.limit(1);
				if (head?.commandId !== failed.commandId) {
					throw new ProfileMemoryStoreConflict("profile_memory_not_ready");
				}
				kind = failed.commandKind as ProfileMemoryCommandKind;
				item = failed.payload;
				subjectId = failed.subjectId;
				if (kind === "owner_transition") {
					targetLifecycle = failed.acceptedLifecycleState as "active" | "paused";
				}
			}
			if (kind === "owner_erase") {
				const [existing] = await tx
					.select()
					.from(profileMemoryCommands)
					.where(
						and(
							eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
							eq(profileMemoryCommands.ownerGeneration, settings.generation),
							eq(profileMemoryCommands.commandKind, "owner_erase"),
						),
					)
					.orderBy(desc(profileMemoryCommands.ownerSequence))
					.limit(1);
				if (
					(settings.lifecycleState === "erasing" || settings.lifecycleState === "erased") &&
					existing &&
					existing.status !== "failed"
				) {
					return mutationResult(settings, existing.commandId);
				}
				const generation =
					settings.lifecycleState === "erasing" ? settings.generation : settings.generation + 1;
				await tx
					.update(profileMemoryCommands)
					.set({ status: "superseded", payload: null, updatedAt: now })
					.where(
						and(
							eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
							eq(profileMemoryCommands.status, "pending_admission"),
						),
					);
				await tx
					.update(profileMemoryCommands)
					.set({ payload: null })
					.where(eq(profileMemoryCommands.ownerUserId, input.ownerUserId));
				settings = { ...settings, generation, lifecycleState: "erasing", eraseRequestedAt: now };
			} else {
				if (
					settings.lifecycleState === "erasing" ||
					(settings.lifecycleState === "erased" && targetLifecycle !== "active")
				) {
					throw new ProfileMemoryStoreConflict("profile_memory_not_ready");
				}
				if (kind === "owner_transition") {
					settings = { ...settings, lifecycleState: targetLifecycle ?? "paused" };
				}
			}
			const sequence = settings.commandSequence + 1;
			const scope =
				kind === "owner_transition"
					? "owner:lifecycle"
					: kind === "owner_erase"
						? `owner:erase:${settings.generation}`
						: `memory:${subjectId}`;
			await tx
				.update(profileMemoryCommands)
				.set({ payload: null })
				.where(
					and(
						eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
						eq(profileMemoryCommands.supersessionScope, scope),
						eq(profileMemoryCommands.status, "failed"),
					),
				);
			await tx.insert(profileMemoryCommands).values({
				commandId: input.commandId,
				ownerUserId: input.ownerUserId,
				ownerGeneration: settings.generation,
				ownerSequence: sequence,
				commandKind: kind,
				subjectId,
				payload: item,
				supersessionScope: scope,
				acceptedLifecycleState: settings.lifecycleState,
				sourceUpdatedAt: now,
				status: "pending_admission",
				idempotencyKeyHash: input.idempotencyKeyHash,
				requestFingerprint: input.requestFingerprint,
				createdAt: now,
				updatedAt: now,
			});
			await tx
				.update(profileMemorySettings)
				.set({
					commandSequence: sequence,
					generation: settings.generation,
					lifecycleState: settings.lifecycleState,
					eraseRequestedAt: settings.eraseRequestedAt,
					updatedAt: now,
				})
				.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
			const syncStatus = await reconcileOwnerMemoryState(tx, {
				ownerUserId: input.ownerUserId,
				generation: settings.generation,
				now,
			});
			return mutationResult({ ...settings, syncStatus }, input.commandId);
		});
	}
	return {
		retryCommand: (input) =>
			enqueue(input, "memory_add", null, null, undefined, input.failedCommandId),
		createItem: (input) => enqueue(input, "memory_add", { text: input.text }, input.commandId),
		updateItem: (input) =>
			enqueue(
				input,
				"memory_update",
				{
					...(input.text === undefined ? {} : { text: input.text }),
					...(input.state === undefined ? {} : { state: input.state }),
				},
				input.memoryId,
			),
		erase: (input) => enqueue(input, "owner_erase", null, null),
		setLifecycle: (input) => enqueue(input, "owner_transition", null, null, input.lifecycleState),
		async findCommandByIdempotency(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const row = await readReplay(tx, input);
				return row ? toCommand(row) : null;
			});
		},
	};
}
