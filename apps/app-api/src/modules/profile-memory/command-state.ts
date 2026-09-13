import { and, desc, eq, inArray } from "drizzle-orm";
import type { RuntimeDbGetter } from "../../db/runtime";
import { profileMemoryCommands, profileMemorySettings } from "../../db/schema";
import type { ProfileMemorySyncStatus } from "./model";
export type ProfileMemoryTransaction = Parameters<
	Parameters<Awaited<ReturnType<RuntimeDbGetter>>["transaction"]>[0]
>[0];
export function deriveProfileMemorySyncStatus(input: {
	hasFailedHead: boolean;
	hasNonterminalHead: boolean;
}): ProfileMemorySyncStatus {
	return input.hasNonterminalHead ? "pending" : input.hasFailedHead ? "failed" : "synced";
}
export async function reconcileOwnerMemoryState(
	tx: ProfileMemoryTransaction,
	input: { ownerUserId: string; generation: number; now: Date },
): Promise<ProfileMemorySyncStatus> {
	// Ordinary writes do not control runtime availability.
	const [head] = await tx
		.select()
		.from(profileMemoryCommands)
		.where(
			and(
				eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
				eq(profileMemoryCommands.ownerGeneration, input.generation),
				inArray(profileMemoryCommands.commandKind, ["owner_transition", "owner_erase"]),
			),
		)
		.orderBy(desc(profileMemoryCommands.ownerSequence))
		.limit(1);
	const syncStatus = deriveProfileMemorySyncStatus({
		hasNonterminalHead: head?.status === "pending_admission" || head?.status === "admitted",
		hasFailedHead: head?.status === "failed",
	});
	await tx
		.update(profileMemorySettings)
		.set({
			syncStatus,
			updatedAt: input.now,
			...(head?.commandKind === "owner_erase" && head.status === "succeeded"
				? { lifecycleState: "erased", erasedAt: head.processedAt ?? input.now }
				: {}),
		})
		.where(
			and(
				eq(profileMemorySettings.ownerUserId, input.ownerUserId),
				eq(profileMemorySettings.generation, input.generation),
			),
		);
	return syncStatus;
}
