import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { RuntimeDatabase } from "../../db/runtime";
import {
	profileMemoryCommandSources,
	profileMemoryCommands,
	profileMemorySettings,
} from "../../db/schema";
import type { ProfileMemorySyncStatus } from "./model";

export const PROFILE_MEMORY_SUPERSESSION_SCOPE = {
	erase: (generation: number) => `owner:erase:${generation}`,
	item: (itemId: string) => `item:${itemId}`,
	lifecycle: "owner:lifecycle",
	sourceBatch: (commandId: string) => `source_batch:${commandId}`,
} as const;

export type ProfileMemoryTransaction = Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];

type CommandRow = typeof profileMemoryCommands.$inferSelect;

export async function supersedePendingCommandsInScope(
	tx: ProfileMemoryTransaction,
	input: {
		generation: number;
		now: Date;
		ownerUserId: string;
		supersessionScope: string;
	},
): Promise<void> {
	const superseded = await tx
		.update(profileMemoryCommands)
		.set({
			acceptedItemKey: null,
			acceptedItemValue: null,
			processedAt: input.now,
			status: "superseded",
			updatedAt: input.now,
		})
		.where(
			and(
				eq(profileMemoryCommands.ownerUserId, input.ownerUserId),
				eq(profileMemoryCommands.ownerGeneration, input.generation),
				eq(profileMemoryCommands.supersessionScope, input.supersessionScope),
				eq(profileMemoryCommands.status, "pending_admission"),
			),
		)
		.returning({ commandId: profileMemoryCommands.commandId });
	if (superseded.length > 0) {
		await tx.delete(profileMemoryCommandSources).where(
			inArray(
				profileMemoryCommandSources.commandId,
				superseded.map((command) => command.commandId),
			),
		);
	}
}

export async function reconcileOwnerMemoryState(
	tx: ProfileMemoryTransaction,
	input: {
		generation: number;
		now: Date;
		ownerUserId: string;
	},
): Promise<ProfileMemorySyncStatus> {
	await tx.execute(sql`
		with current_item_heads as (
			select
				item."item_id",
				item."owner_generation",
				item."owner_user_id",
				head."last_error_code",
				head."status",
				head."updated_at"
			from "profile"."memory_items" as item
			cross join lateral (
				select
					command."command_kind",
					command."last_error_code",
					command."status",
					command."subject_id",
					command."subject_revision",
					command."updated_at"
				from "profile"."memory_commands" as command
				where command."owner_user_id" = item."owner_user_id"
					and command."owner_generation" = item."owner_generation"
					and command."supersession_scope" = 'item:' || item."item_id"
				order by command."owner_sequence" desc
				limit 1
			) as head
			where item."owner_user_id" = ${input.ownerUserId}
				and item."owner_generation" = ${input.generation}
				and head."command_kind" in ('item_upsert', 'item_delete')
				and head."subject_id" = item."item_id"
				and head."subject_revision" = item."revision"
				and head."status" in ('pending_admission', 'admitted', 'failed', 'succeeded')
		)
		update "profile"."memory_items" as item
		set
			"sync_error_code" = case when head."status" = 'failed' then head."last_error_code" else null end,
			"sync_status" = case
				when head."status" in ('pending_admission', 'admitted') then 'pending'
				when head."status" = 'failed' then 'failed'
				else 'synced'
			end,
			"updated_at" = head."updated_at"
		from current_item_heads as head
		where item."owner_user_id" = head."owner_user_id"
			and item."owner_generation" = head."owner_generation"
			and item."item_id" = head."item_id"
			and (
				item."sync_error_code" is distinct from
					case when head."status" = 'failed' then head."last_error_code" else null end
				or item."sync_status" is distinct from case
					when head."status" in ('pending_admission', 'admitted') then 'pending'
					when head."status" = 'failed' then 'failed'
					else 'synced'
				end
				or item."updated_at" is distinct from head."updated_at"
			)
	`);

	const ownerStateRows = await tx
		.select({
			eraseIsLatestLifecycleHead: sql<boolean>`exists (
				select 1
				from "profile"."memory_commands" as erase_head
				where erase_head."owner_user_id" = ${input.ownerUserId}
					and erase_head."owner_generation" = ${input.generation}
					and erase_head."command_kind" = 'owner_erase'
					and erase_head."supersession_scope" = ${PROFILE_MEMORY_SUPERSESSION_SCOPE.erase(input.generation)}
					and erase_head."status" = 'succeeded'
					and not exists (
						select 1
						from "profile"."memory_commands" as later_erase
						where later_erase."owner_user_id" = erase_head."owner_user_id"
							and later_erase."owner_generation" = erase_head."owner_generation"
							and later_erase."supersession_scope" = erase_head."supersession_scope"
							and later_erase."owner_sequence" > erase_head."owner_sequence"
					)
					and not exists (
						select 1
						from "profile"."memory_commands" as lifecycle_head
						where lifecycle_head."owner_user_id" = erase_head."owner_user_id"
							and lifecycle_head."owner_generation" = erase_head."owner_generation"
							and lifecycle_head."supersession_scope" = ${PROFILE_MEMORY_SUPERSESSION_SCOPE.lifecycle}
							and lifecycle_head."owner_sequence" > erase_head."owner_sequence"
					)
			)`,
			eraseProcessedAt: sql<Date | null>`(
				select erase_head."processed_at"
				from "profile"."memory_commands" as erase_head
				where erase_head."owner_user_id" = ${input.ownerUserId}
					and erase_head."owner_generation" = ${input.generation}
					and erase_head."command_kind" = 'owner_erase'
					and erase_head."supersession_scope" = ${PROFILE_MEMORY_SUPERSESSION_SCOPE.erase(input.generation)}
					and erase_head."status" = 'succeeded'
					and not exists (
						select 1
						from "profile"."memory_commands" as later_erase
						where later_erase."owner_user_id" = erase_head."owner_user_id"
							and later_erase."owner_generation" = erase_head."owner_generation"
							and later_erase."supersession_scope" = erase_head."supersession_scope"
							and later_erase."owner_sequence" > erase_head."owner_sequence"
					)
					and not exists (
						select 1
						from "profile"."memory_commands" as lifecycle_head
						where lifecycle_head."owner_user_id" = erase_head."owner_user_id"
							and lifecycle_head."owner_generation" = erase_head."owner_generation"
							and lifecycle_head."supersession_scope" = ${PROFILE_MEMORY_SUPERSESSION_SCOPE.lifecycle}
							and lifecycle_head."owner_sequence" > erase_head."owner_sequence"
					)
				limit 1
			)`,
			hasFailedHead: sql<boolean>`exists (
				select 1
				from "profile"."memory_commands" as failed_head
				where failed_head."owner_user_id" = ${input.ownerUserId}
					and failed_head."owner_generation" = ${input.generation}
					and failed_head."status" = 'failed'
					and not exists (
						select 1
						from "profile"."memory_commands" as later
						where later."owner_user_id" = failed_head."owner_user_id"
							and later."owner_generation" = failed_head."owner_generation"
							and later."supersession_scope" = failed_head."supersession_scope"
							and later."owner_sequence" > failed_head."owner_sequence"
					)
			)`,
			hasNonterminalHead: sql<boolean>`exists (
				select 1
				from "profile"."memory_commands" as nonterminal_head
				where nonterminal_head."owner_user_id" = ${input.ownerUserId}
					and nonterminal_head."owner_generation" = ${input.generation}
					and nonterminal_head."status" in ('pending_admission', 'admitted')
					and not exists (
						select 1
						from "profile"."memory_commands" as later
						where later."owner_user_id" = nonterminal_head."owner_user_id"
							and later."owner_generation" = nonterminal_head."owner_generation"
							and later."supersession_scope" = nonterminal_head."supersession_scope"
							and later."owner_sequence" > nonterminal_head."owner_sequence"
					)
			)`,
		})
		.from(profileMemorySettings)
		.where(
			and(
				eq(profileMemorySettings.ownerUserId, input.ownerUserId),
				eq(profileMemorySettings.generation, input.generation),
			),
		)
		.limit(1);
	const ownerState = ownerStateRows[0];
	const hasFailedHead = ownerState?.hasFailedHead ?? false;
	const hasNonterminalHead = ownerState?.hasNonterminalHead ?? false;
	const syncStatus: ProfileMemorySyncStatus = hasFailedHead
		? "failed"
		: hasNonterminalHead
			? "pending"
			: "synced";
	await tx
		.update(profileMemorySettings)
		.set({
			...(ownerState?.eraseIsLatestLifecycleHead
				? { erasedAt: ownerState.eraseProcessedAt ?? input.now, lifecycleState: "erased" }
				: {}),
			syncStatus,
			updatedAt: input.now,
		})
		.where(
			and(
				eq(profileMemorySettings.ownerUserId, input.ownerUserId),
				eq(profileMemorySettings.generation, input.generation),
			),
		);

	return syncStatus;
}

export async function isCurrentCommandScopeHead(
	tx: ProfileMemoryTransaction,
	command: CommandRow,
): Promise<boolean> {
	const rows = await tx
		.select({ commandId: profileMemoryCommands.commandId })
		.from(profileMemoryCommands)
		.where(
			and(
				eq(profileMemoryCommands.ownerUserId, command.ownerUserId),
				eq(profileMemoryCommands.ownerGeneration, command.ownerGeneration),
				eq(profileMemoryCommands.supersessionScope, command.supersessionScope),
			),
		)
		.orderBy(desc(profileMemoryCommands.ownerSequence))
		.limit(1);
	return rows[0]?.commandId === command.commandId;
}
