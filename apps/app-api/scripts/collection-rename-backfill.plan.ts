import type { RequestExecutionStatus } from "../src/modules/runtime-command";

import {
	COLLECTION_RENAME_MAP,
	type CollectionRenameBackfillPlan,
	type CollectionRenameBackfillPlanInput,
	type LegacyCollectionName,
	type ReplayEventType,
} from "./collection-rename-backfill.shared";

export function resolveCollectionRename(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	return COLLECTION_RENAME_MAP[value as LegacyCollectionName] ?? null;
}

export function rewriteScopeSummary(value: string | null): string | null {
	if (!value) {
		return value;
	}
	const legacyCollection = value.startsWith("regulations/")
		? value.slice("regulations/".length)
		: "";
	const renamedCollection = resolveCollectionRename(legacyCollection);
	if (!renamedCollection) {
		return value;
	}
	return `regulations/${renamedCollection}`;
}

export function rewriteResolvedScope(
	scope: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (!scope) {
		return scope;
	}
	const corpus = typeof scope.corpus === "string" ? scope.corpus : null;
	const collection = typeof scope.collection === "string" ? scope.collection : null;
	if (corpus !== "regulations" || !collection) {
		return scope;
	}
	const renamedCollection = resolveCollectionRename(collection);
	if (!renamedCollection) {
		return scope;
	}
	return {
		...scope,
		collection: renamedCollection,
	};
}

export function resolveProjectionReplayEventType(status: RequestExecutionStatus): ReplayEventType {
	switch (status) {
		case "accepted":
			return "request.accepted";
		case "completed":
			return "request.completed";
		case "needs_clarification":
			return "request.needs_clarification";
		case "no_answer":
			return "request.no_answer";
		case "error":
			return "request.error";
		case "approval_required":
			return "request.approval_required";
		case "rejected":
			return "request.rejected";
		case "cancelled":
			return "request.cancelled";
		default: {
			const exhaustiveStatus: never = status;
			throw new Error(`Unsupported request execution status: ${String(exhaustiveStatus)}`);
		}
	}
}

export function buildCollectionRenameBackfillPlan(
	input: CollectionRenameBackfillPlanInput,
): CollectionRenameBackfillPlan {
	const nextResolvedScopeJson = rewriteResolvedScope(input.resolvedScopeJson);
	const nextRuntimeCollection =
		resolveCollectionRename(input.runtimeCollection) ?? input.runtimeCollection ?? null;
	const nextResolvedScopeSummary = rewriteScopeSummary(input.resolvedScopeSummary);
	const nextGradeCollection =
		resolveCollectionRename(input.gradeCollection) ??
		nextRuntimeCollection ??
		input.gradeCollection ??
		null;

	return {
		hasChanges:
			JSON.stringify(nextResolvedScopeJson) !== JSON.stringify(input.resolvedScopeJson) ||
			nextRuntimeCollection !== input.runtimeCollection ||
			nextResolvedScopeSummary !== input.resolvedScopeSummary ||
			nextGradeCollection !== input.gradeCollection,
		nextGradeCollection,
		nextResolvedScopeJson,
		nextResolvedScopeSummary,
		nextRuntimeCollection,
		replayEventType: resolveProjectionReplayEventType(input.requestStatus),
		requestId: input.requestId,
		requestStatus: input.requestStatus,
	};
}
