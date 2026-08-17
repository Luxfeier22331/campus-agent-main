import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
	profileMemoryCommandSources,
	profileMemoryCommands,
	profileMemorySettings,
} from "../../db/schema";
import {
	PROFILE_MEMORY_SUPERSESSION_SCOPE,
	type ProfileMemoryTransaction,
	reconcileOwnerMemoryState,
} from "./command-state";

export type ConversationSourceMutation = "conversation_delete" | "conversation_prune";

export interface ConversationSourceGroup {
	conversationId: string;
	sourceMessageIds: string[];
}

export async function invalidateConversationSources(
	tx: ProfileMemoryTransaction,
	input: {
		mutation: ConversationSourceMutation;
		now: Date;
		ownerUserId: string;
		reconcileWhenUnchanged: boolean;
		sources: ConversationSourceGroup[];
	},
): Promise<void> {
	await tx
		.insert(profileMemorySettings)
		.values({ ownerUserId: input.ownerUserId, updatedAt: input.now })
		.onConflictDoNothing({ target: profileMemorySettings.ownerUserId });

	const settingsRows = await tx
		.select()
		.from(profileMemorySettings)
		.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId))
		.limit(1)
		.for("update");
	const settings = settingsRows[0];
	if (!settings || (settings.lifecycleState !== "active" && settings.lifecycleState !== "paused")) {
		return;
	}

	let sequence = settings.commandSequence;
	for (const source of input.sources) {
		for (const chunk of chunkSourceMessageIds(source.sourceMessageIds)) {
			sequence += 1;
			const commandId = createMemorySourceCommandId();
			const hash = sourceCommandHash(commandId);
			await tx.insert(profileMemoryCommands).values({
				acceptedLifecycleState: settings.lifecycleState,
				commandId,
				commandKind: input.mutation,
				createdAt: input.now,
				idempotencyKeyHash: hash,
				ownerGeneration: settings.generation,
				ownerSequence: sequence,
				ownerUserId: input.ownerUserId,
				requestFingerprint: hash,
				sourceUpdatedAt: input.now,
				status: "pending_admission",
				subjectId: source.conversationId,
				supersessionScope: PROFILE_MEMORY_SUPERSESSION_SCOPE.sourceBatch(commandId),
				updatedAt: input.now,
			});
			await tx
				.insert(profileMemoryCommandSources)
				.values(chunk.map((sourceMessageId) => ({ commandId, sourceMessageId })));
		}
	}

	const sequenceChanged = sequence !== settings.commandSequence;
	if (!(sequenceChanged || input.reconcileWhenUnchanged)) {
		return;
	}

	await tx
		.update(profileMemorySettings)
		.set({ commandSequence: sequence, updatedAt: input.now })
		.where(eq(profileMemorySettings.ownerUserId, input.ownerUserId));
	await reconcileOwnerMemoryState(tx, {
		generation: settings.generation,
		now: input.now,
		ownerUserId: input.ownerUserId,
	});
}

function createMemorySourceCommandId(): string {
	return `memcmd_${randomUUID().replaceAll("-", "")}`;
}

function sourceCommandHash(commandId: string): string {
	return createHash("sha256").update(commandId, "utf8").digest("hex");
}

function chunkSourceMessageIds(sourceMessageIds: string[]): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < sourceMessageIds.length; index += 50) {
		chunks.push(sourceMessageIds.slice(index, index + 50));
	}
	return chunks;
}
