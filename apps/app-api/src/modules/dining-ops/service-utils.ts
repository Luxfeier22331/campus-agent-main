import { AppApiRouteError } from "../../http";
import { advanceDraftVersion } from "./release-lifecycle";
import type {
	DiningAuditEvent,
	DiningOperationsState,
	DiningOpsActor,
	DiningPublishedSnapshot,
} from "./types";

export function toJsonRecord(value: unknown): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function createAuditEvent(input: {
	action: string;
	actor: DiningOpsActor;
	after: Record<string, unknown> | null;
	before: Record<string, unknown> | null;
	objectId: string;
	objectKind: string;
}): DiningAuditEvent {
	const occurredAt = new Date().toISOString();
	return {
		action: input.action,
		actorDisplayName: input.actor.displayName,
		actorPrincipalId: input.actor.principalId,
		after: input.after,
		auditEventId: `dining_audit:${Date.parse(occurredAt).toString(36)}:${input.action}:${input.objectId}`,
		before: input.before,
		objectId: input.objectId,
		objectKind: input.objectKind,
		occurredAt,
	};
}

export function stableId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-|-$/g, "");
}

export function upsertById<T, K extends keyof T>(items: T[], key: K, next: T): T[] {
	const index = items.findIndex((item) => item[key] === next[key]);
	if (index < 0) {
		return [...items, next];
	}
	return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

export function findFloorRef(state: DiningOperationsState, floorId: string) {
	for (const hall of state.halls) {
		const floor = hall.floors.find((item) => item.floorId === floorId);
		if (floor) {
			return { floorId: floor.floorId, hallId: hall.hallId };
		}
	}
	throw new AppApiRouteError({
		code: "dining_floor_not_found",
		message: "Dining floor projection was not found.",
		retryable: false,
		status: 404,
	});
}

export function advanceStateDraftVersion(
	state: DiningOperationsState,
	actor: DiningOpsActor,
	summary: Record<string, unknown>,
): void {
	const nextVersion = advanceDraftVersion({ actor, state, summary });
	state.currentDraftVersion = nextVersion;
	state.draftVersions.push(nextVersion);
}

export function requireCandidateSnapshot(
	state: DiningOperationsState,
	candidateId: string,
): DiningPublishedSnapshot {
	const snapshot = state.candidateSnapshots[candidateId];
	if (!snapshot) {
		throw new AppApiRouteError({
			code: "dining_release_candidate_snapshot_missing",
			message: "Dining release candidate snapshot is missing.",
			retryable: false,
			status: 409,
		});
	}
	return snapshot;
}

export function requireReleaseSnapshot(
	state: DiningOperationsState,
	releaseId: string,
): DiningPublishedSnapshot {
	const snapshot = state.releaseSnapshots[releaseId];
	if (!snapshot) {
		throw new AppApiRouteError({
			code: "dining_release_snapshot_missing",
			message: "Dining release snapshot is missing.",
			retryable: false,
			status: 500,
		});
	}
	return snapshot;
}

export function cloneState(state: DiningOperationsState): DiningOperationsState {
	return JSON.parse(JSON.stringify(state)) as DiningOperationsState;
}
