import { AppApiRouteError } from "../../http";
import {
	definedFields,
	requireAssignment,
	requireMenuItem,
	requireMenuOffering,
	requireStallProfile,
	requireWindow,
} from "./guards";
import { createInitialDiningOperationsState } from "./initial-state";
import { buildFloorResponse, floorKey, toPublicFloor, toPublicHallSummary } from "./projection";
import {
	approveCandidate,
	cancelCandidate,
	createCandidateFromDraft,
	publishCandidate,
	reportForCandidate,
	requireRelease,
	requireReleaseCandidate,
	scheduleCandidate,
	validateCandidate,
} from "./release-lifecycle";
import {
	advanceStateDraftVersion,
	cloneState,
	createAuditEvent,
	requireCandidateSnapshot,
	requireReleaseSnapshot,
	stableId,
	toJsonRecord,
	upsertById,
} from "./service-utils";
import type {
	DiningMenuItem,
	DiningMenuOffering,
	DiningOperationsService,
	DiningOperationsState,
	DiningOperationsStore,
	DiningStallProfile,
	DiningWindowAssignment,
} from "./types";

export { DINING_CANVAS, DINING_SOURCE, INITIAL_DINING_HALL_SEEDS } from "./initial-data";
export { createInitialDiningOperationsState } from "./initial-state";
export type {
	DiningAuditEvent,
	DiningMenuItem,
	DiningMenuOffering,
	DiningOperationsService,
	DiningOperationsState,
	DiningOperationsStore,
	DiningOpsActor,
	DiningOpsFloorResponse,
	DiningOpsHall,
	DiningPublishedSnapshot,
	DiningRelease,
	DiningReleaseStatus,
	DiningStallProfile,
	DiningWindow,
	DiningWindowAssignment,
	DiningWindowStatus,
} from "./types";

export function createInMemoryDiningOperationsStore(
	initialState: DiningOperationsState = createInitialDiningOperationsState(),
): DiningOperationsStore {
	let state = cloneState(initialState);
	return {
		async getState() {
			return cloneState(state);
		},
		async saveState(nextState) {
			state = cloneState(nextState);
		},
	};
}

let processStore: DiningOperationsStore | null = null;

export function createProcessDiningOperationsStore(): DiningOperationsStore {
	if (!processStore) {
		processStore = createInMemoryDiningOperationsStore();
	}
	return processStore;
}

export function buildDiningOperationsService(input: {
	store: DiningOperationsStore;
}): DiningOperationsService {
	return {
		async assignWindow({ actor, input: assignmentInput }) {
			const state = await input.store.getState();
			const window = requireWindow(state, assignmentInput.windowId);
			const stallProfile: DiningStallProfile = {
				displayName: assignmentInput.stallProfile.displayName,
				stallProfileId: `stall:${assignmentInput.windowId}`,
				stallType: assignmentInput.stallProfile.stallType,
				status: "active",
				tags: assignmentInput.stallProfile.tags,
			};
			const assignment: DiningWindowAssignment = {
				assignmentId: `assignment:${window.hallId}:${window.floorId}:${window.windowId}`,
				stallProfileId: stallProfile.stallProfileId,
				status: "active",
				windowId: window.windowId,
			};

			state.stallProfiles = upsertById(state.stallProfiles, "stallProfileId", stallProfile);
			state.assignments = upsertById(state.assignments, "assignmentId", assignment);
			state.auditEvents.push(
				createAuditEvent({
					action: "window_assignment.upserted",
					actor,
					after: toJsonRecord(assignment),
					before: null,
					objectId: assignment.assignmentId,
					objectKind: "dining.window_assignment",
				}),
			);
			advanceStateDraftVersion(state, actor, {
				action: "window_assignment.upserted",
				assignmentId: assignment.assignmentId,
			});
			await input.store.saveState(state);
			return { assignment, stallProfile };
		},
		async createMenuItem({ actor, input: menuInput }) {
			const state = await input.store.getState();
			const menuItem: DiningMenuItem = {
				menuItemId: `menu:${stableId(menuInput.name)}:${state.menuItems.length + 1}`,
				name: menuInput.name,
				status: "active",
				tags: menuInput.tags,
			};
			state.menuItems.push(menuItem);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_item.created",
					actor,
					after: toJsonRecord(menuItem),
					before: null,
					objectId: menuItem.menuItemId,
					objectKind: "dining.menu_item",
				}),
			);
			advanceStateDraftVersion(state, actor, {
				action: "menu_item.created",
				menuItemId: menuItem.menuItemId,
			});
			await input.store.saveState(state);
			return { menuItem };
		},
		async createMenuOffering({ actor, input: offeringInput }) {
			const state = await input.store.getState();
			const assignment = requireAssignment(state, offeringInput.assignmentId);
			const menuItem = requireMenuItem(state, offeringInput.menuItemId);
			const offering: DiningMenuOffering = {
				assignmentId: assignment.assignmentId,
				menuItemId: menuItem.menuItemId,
				offeringId: `offering:${assignment.assignmentId}:${menuItem.menuItemId}`,
				priceLabel: offeringInput.priceLabel,
			};
			if (state.menuOfferings.some((item) => item.offeringId === offering.offeringId)) {
				throw new AppApiRouteError({
					code: "dining_menu_offering_conflict",
					message: "Dining menu offering already exists.",
					retryable: false,
					status: 409,
				});
			}
			state.menuOfferings.push(offering);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_offering.created",
					actor,
					after: toJsonRecord(offering),
					before: null,
					objectId: offering.offeringId,
					objectKind: "dining.menu_offering",
				}),
			);
			advanceStateDraftVersion(state, actor, {
				action: "menu_offering.created",
				offeringId: offering.offeringId,
			});
			await input.store.saveState(state);
			return { offering };
		},
		async getFloor(floorInput) {
			const state = await input.store.getState();
			return buildFloorResponse(state, floorInput);
		},
		async getPublishedFloor(floorInput) {
			const state = await input.store.getState();
			if (!state.publishedSnapshot) {
				throw new AppApiRouteError({
					code: "dining_release_not_published",
					message: "Published dining projection is not available.",
					retryable: false,
					status: 404,
				});
			}
			const floor = state.publishedSnapshot.floors[floorKey(floorInput)];
			if (!floor) {
				throw new AppApiRouteError({
					code: "dining_floor_not_found",
					message: "Dining floor projection was not found.",
					retryable: false,
					status: 404,
				});
			}
			return toPublicFloor(floor, state.publishedSnapshot.source);
		},
		async getPublishedHalls() {
			const state = await input.store.getState();
			if (!state.publishedSnapshot) {
				return { halls: [] };
			}
			const snapshot = state.publishedSnapshot;
			return {
				halls: snapshot.halls.map((hall) => toPublicHallSummary(hall, snapshot)),
			};
		},
		async listAuditEvents() {
			const state = await input.store.getState();
			return { events: [...state.auditEvents].reverse() };
		},
		async listHalls() {
			const state = await input.store.getState();
			return { halls: state.halls };
		},
		async listReleaseCandidates() {
			const state = await input.store.getState();
			return { candidates: [...state.releaseCandidates].reverse() };
		},
		async listReleases() {
			const state = await input.store.getState();
			return { releases: [...state.releases].reverse() };
		},
		async createReleaseCandidate({ actor, input: candidateInput }) {
			const state = await input.store.getState();
			const envelope = createCandidateFromDraft({
				actor,
				notes: candidateInput.notes,
				state,
			});
			state.releaseCandidates.push(envelope.candidate);
			state.candidateSnapshots[envelope.candidate.candidateId] = envelope.snapshot;
			state.auditEvents.push(
				createAuditEvent({
					action: "release_candidate.created",
					actor,
					after: toJsonRecord(envelope.candidate),
					before: null,
					objectId: envelope.candidate.candidateId,
					objectKind: "dining.release_candidate",
				}),
			);
			await input.store.saveState(state);
			return envelope;
		},
		async getReleaseCandidate({ candidateId }) {
			const state = await input.store.getState();
			const candidate = requireReleaseCandidate(state, candidateId);
			return {
				candidate,
				snapshot: requireCandidateSnapshot(state, candidateId),
				validationReport: reportForCandidate(state, candidateId),
			};
		},
		async validateReleaseCandidate({ actor, candidateId }) {
			const state = await input.store.getState();
			const candidate = requireReleaseCandidate(state, candidateId);
			const report = validateCandidate({ candidate, state });
			const nextCandidate = {
				...candidate,
				status: report.status === "pass" ? ("validated" as const) : candidate.status,
			};
			state.releaseCandidates = upsertById(state.releaseCandidates, "candidateId", nextCandidate);
			state.releaseCandidateValidationReports = upsertById(
				state.releaseCandidateValidationReports,
				"candidateId",
				report,
			);
			state.auditEvents.push(
				createAuditEvent({
					action: "release_candidate.validated",
					actor,
					after: toJsonRecord({ candidate: nextCandidate, validationReport: report }),
					before: toJsonRecord(candidate),
					objectId: candidateId,
					objectKind: "dining.release_candidate",
				}),
			);
			await input.store.saveState(state);
			return {
				candidate: nextCandidate,
				snapshot: requireCandidateSnapshot(state, candidateId),
				validationReport: report,
			};
		},
		async approveReleaseCandidate({ actor, candidateId }) {
			const state = await input.store.getState();
			const candidate = requireReleaseCandidate(state, candidateId);
			const report = validateCandidate({ candidate, state });
			const nextCandidate = approveCandidate({ actor, candidate, report });
			state.releaseCandidates = upsertById(state.releaseCandidates, "candidateId", nextCandidate);
			state.releaseCandidateValidationReports = upsertById(
				state.releaseCandidateValidationReports,
				"candidateId",
				report,
			);
			state.auditEvents.push(
				createAuditEvent({
					action: "release_candidate.approved",
					actor,
					after: toJsonRecord(nextCandidate),
					before: toJsonRecord(candidate),
					objectId: candidateId,
					objectKind: "dining.release_candidate",
				}),
			);
			await input.store.saveState(state);
			return {
				candidate: nextCandidate,
				snapshot: requireCandidateSnapshot(state, candidateId),
				validationReport: report,
			};
		},
		async scheduleReleaseCandidate({ actor, candidateId, input: scheduleInput }) {
			const state = await input.store.getState();
			const candidate = requireReleaseCandidate(state, candidateId);
			const scheduled = scheduleCandidate({
				actor,
				candidate,
				existingJobCount: state.releaseScheduleJobs.length,
				scheduledAt: scheduleInput.scheduledAt,
			});
			state.releaseCandidates = upsertById(
				state.releaseCandidates,
				"candidateId",
				scheduled.candidate,
			);
			state.releaseScheduleJobs = upsertById(
				state.releaseScheduleJobs,
				"scheduleJobId",
				scheduled.scheduleJob,
			);
			state.auditEvents.push(
				createAuditEvent({
					action: "release_candidate.scheduled",
					actor,
					after: toJsonRecord(scheduled),
					before: toJsonRecord(candidate),
					objectId: candidateId,
					objectKind: "dining.release_candidate",
				}),
			);
			await input.store.saveState(state);
			return {
				candidate: scheduled.candidate,
				scheduleJob: scheduled.scheduleJob,
				snapshot: requireCandidateSnapshot(state, candidateId),
				validationReport: reportForCandidate(state, candidateId),
			};
		},
		async publishReleaseCandidate({ actor, candidateId }) {
			const state = await input.store.getState();
			const candidate = requireReleaseCandidate(state, candidateId);
			const report = validateCandidate({ candidate, state });
			const published = publishCandidate({
				actor,
				candidate,
				releaseCount: state.releases.length,
				report,
				state,
			});
			state.releaseCandidates = upsertById(
				state.releaseCandidates,
				"candidateId",
				published.candidate,
			);
			state.releaseCandidateValidationReports = upsertById(
				state.releaseCandidateValidationReports,
				"candidateId",
				report,
			);
			state.releases.push(published.release);
			state.releaseSnapshots[published.release.releaseId] = published.snapshot;
			state.releaseLatestPointer = published.latestPointer;
			state.publishedRelease = published.release;
			state.publishedSnapshot = published.snapshot;
			state.auditEvents.push(
				createAuditEvent({
					action: "release.published",
					actor,
					after: toJsonRecord(published.release),
					before: null,
					objectId: published.release.releaseId,
					objectKind: "dining.release",
				}),
			);
			await input.store.saveState(state);
			return {
				release: published.release,
				snapshot: published.snapshot,
			};
		},
		async cancelReleaseCandidate({ actor, candidateId }) {
			const state = await input.store.getState();
			const candidate = requireReleaseCandidate(state, candidateId);
			const nextCandidate = cancelCandidate({ actor, candidate });
			state.releaseCandidates = upsertById(state.releaseCandidates, "candidateId", nextCandidate);
			state.auditEvents.push(
				createAuditEvent({
					action: "release_candidate.cancelled",
					actor,
					after: toJsonRecord(nextCandidate),
					before: toJsonRecord(candidate),
					objectId: candidateId,
					objectKind: "dining.release_candidate",
				}),
			);
			await input.store.saveState(state);
			return {
				candidate: nextCandidate,
				snapshot: requireCandidateSnapshot(state, candidateId),
				validationReport: reportForCandidate(state, candidateId),
			};
		},
		async getRelease({ releaseId }) {
			const state = await input.store.getState();
			const release = requireRelease(state, releaseId);
			return {
				release,
				snapshot: requireReleaseSnapshot(state, releaseId),
			};
		},
		async rollbackRelease({ actor, input: rollbackInput, releaseId }) {
			if (rollbackInput.mode !== "latest_pointer") {
				throw new AppApiRouteError({
					code: "validation_failed",
					details: { field: "mode" },
					message: "mode is invalid.",
					retryable: false,
					status: 400,
				});
			}
			const state = await input.store.getState();
			const release = requireRelease(state, releaseId);
			const snapshot = requireReleaseSnapshot(state, releaseId);
			state.publishedRelease = release;
			state.publishedSnapshot = snapshot;
			state.releaseLatestPointer = {
				releaseId,
				scope: "global",
				snapshotId: `snapshot:${releaseId}`,
				updatedAt: new Date().toISOString(),
				updatedBy: actor.principalId,
			};
			state.auditEvents.push(
				createAuditEvent({
					action: "release.rollback",
					actor,
					after: toJsonRecord({ notes: rollbackInput.notes, releaseId }),
					before: null,
					objectId: releaseId,
					objectKind: "dining.release",
				}),
			);
			await input.store.saveState(state);
			return { release, snapshot };
		},
		async updateMenuItem({ actor, input: menuInput, menuItemId }) {
			const state = await input.store.getState();
			const before = requireMenuItem(state, menuItemId);
			const menuItem = {
				...before,
				...definedFields(menuInput),
			};
			state.menuItems = upsertById(state.menuItems, "menuItemId", menuItem);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_item.updated",
					actor,
					after: toJsonRecord(menuItem),
					before: toJsonRecord(before),
					objectId: menuItem.menuItemId,
					objectKind: "dining.menu_item",
				}),
			);
			advanceStateDraftVersion(state, actor, {
				action: "menu_item.updated",
				menuItemId,
			});
			await input.store.saveState(state);
			return { menuItem };
		},
		async updateMenuOffering({ actor, input: offeringInput, offeringId }) {
			const state = await input.store.getState();
			const before = requireMenuOffering(state, offeringId);
			const offering = {
				...before,
				...definedFields(offeringInput),
			};
			state.menuOfferings = upsertById(state.menuOfferings, "offeringId", offering);
			state.auditEvents.push(
				createAuditEvent({
					action: "menu_offering.updated",
					actor,
					after: toJsonRecord(offering),
					before: toJsonRecord(before),
					objectId: offering.offeringId,
					objectKind: "dining.menu_offering",
				}),
			);
			advanceStateDraftVersion(state, actor, {
				action: "menu_offering.updated",
				offeringId,
			});
			await input.store.saveState(state);
			return { offering };
		},
		async updateWindow({ actor, input: windowInput, windowId }) {
			const state = await input.store.getState();
			const before = requireWindow(state, windowId);
			const window = {
				...before,
				...definedFields(windowInput),
			};
			state.windows = upsertById(state.windows, "windowId", window);
			state.auditEvents.push(
				createAuditEvent({
					action: "window.updated",
					actor,
					after: toJsonRecord(window),
					before: toJsonRecord(before),
					objectId: window.windowId,
					objectKind: "dining.window",
				}),
			);
			advanceStateDraftVersion(state, actor, {
				action: "window.updated",
				windowId,
			});
			await input.store.saveState(state);
			return { window };
		},
		async updateWindowAssignment({ actor, assignmentId, input: assignmentInput }) {
			const state = await input.store.getState();
			const beforeAssignment = requireAssignment(state, assignmentId);
			const beforeProfile = requireStallProfile(state, beforeAssignment.stallProfileId);
			const assignment = {
				...beforeAssignment,
				...definedFields({ status: assignmentInput.status }),
			};
			const stallProfile = assignmentInput.stallProfile
				? {
						...beforeProfile,
						...assignmentInput.stallProfile,
					}
				: beforeProfile;
			state.assignments = upsertById(state.assignments, "assignmentId", assignment);
			state.stallProfiles = upsertById(state.stallProfiles, "stallProfileId", stallProfile);
			state.auditEvents.push(
				createAuditEvent({
					action: "window_assignment.updated",
					actor,
					after: toJsonRecord({ assignment, stallProfile }),
					before: toJsonRecord({ assignment: beforeAssignment, stallProfile: beforeProfile }),
					objectId: assignment.assignmentId,
					objectKind: "dining.window_assignment",
				}),
			);
			advanceStateDraftVersion(state, actor, {
				action: "window_assignment.updated",
				assignmentId,
			});
			await input.store.saveState(state);
			return { assignment, stallProfile };
		},
	};
}
