import { DiningDomainError } from "./error";
import { resolveDiningFloorplanManifestRef } from "./floorplan-manifest";
import { sha256Tag, stableJson } from "./hash";
import { buildPublishedSnapshot, floorKey } from "./projection";
import type {
	DiningDraftVersion,
	DiningFloorplanManifestRef,
	DiningFloorplanRef,
	DiningReleaseCandidate,
	DiningReleaseCandidateEnvelope,
	DiningReleaseCandidateStatus,
	DiningReleaseCandidateValidationReport,
	DiningReleaseLatestPointer,
	DiningReleaseScheduleJob,
	DiningReleaseValidationIssue,
} from "./release-types";
import { createDiningDraftVersion, DINING_SYSTEM_SOURCE } from "./state-factory";
import type {
	DiningOperationsState,
	DiningOpsActor,
	DiningPublishedSnapshot,
	DiningRelease,
} from "./types";

export function createCandidateFromDraft(input: {
	actor: DiningOpsActor;
	notes: string;
	state: DiningOperationsState;
}): DiningReleaseCandidateEnvelope {
	const snapshot = buildPublishedSnapshot(
		input.state,
		"dining_release:candidate",
		DINING_SYSTEM_SOURCE,
	);
	const now = new Date().toISOString();
	const snapshotHash = sha256Tag(stableJson(snapshot));
	const candidate: DiningReleaseCandidate = {
		approvedAt: null,
		approvedBy: null,
		baseDraftVersionId: input.state.currentDraftVersion.draftVersionId,
		cancelledAt: null,
		cancelledBy: null,
		candidateId: `dining_release_candidate:${Date.parse(now).toString(36)}:${input.state.releaseCandidates.length + 1}`,
		createdAt: now,
		createdBy: input.actor.principalId,
		expectedPredecessorReleaseId: input.state.releaseLatestPointer?.releaseId ?? null,
		floorplanRefs: buildFloorplanRefs(input.state),
		notes: input.notes,
		publishedReleaseId: null,
		publishMode: "manual",
		scheduledAt: null,
		snapshotHash,
		status: "candidate",
	};
	return { candidate, snapshot, validationReport: null };
}

export function validateCandidate(input: {
	candidate: DiningReleaseCandidate;
	state: DiningOperationsState;
}): DiningReleaseCandidateValidationReport {
	const blockers: DiningReleaseValidationIssue[] = [];
	const snapshot = input.state.candidateSnapshots[input.candidate.candidateId];
	if (!snapshot) {
		blockers.push(issue("missing_floorplan_manifest", "Candidate snapshot is missing.", {}));
	}
	if (input.state.currentDraftVersion.draftVersionId !== input.candidate.baseDraftVersionId) {
		blockers.push(
			issue("stale_release_candidate", "Draft version changed after candidate creation.", {
				baseDraftVersionId: input.candidate.baseDraftVersionId,
				currentDraftVersionId: input.state.currentDraftVersion.draftVersionId,
			}),
		);
	}
	if (
		input.state.releaseLatestPointer?.releaseId !== input.candidate.expectedPredecessorReleaseId
	) {
		blockers.push(
			issue("stale_release_candidate", "Latest release pointer no longer matches candidate.", {
				expectedPredecessorReleaseId: input.candidate.expectedPredecessorReleaseId ?? "",
				releaseId: input.state.releaseLatestPointer?.releaseId ?? "",
			}),
		);
	}
	for (const ref of input.candidate.floorplanRefs) {
		validateFloorplanRef({ blockers, ref, snapshot, state: input.state });
	}
	validateSnapshotProjection({ blockers, snapshot });
	const now = new Date().toISOString();
	return {
		blockers,
		candidateId: input.candidate.candidateId,
		createdAt: now,
		status: blockers.length === 0 ? "pass" : "fail",
		summary: {
			blockerCount: blockers.length,
			floorCount: input.candidate.floorplanRefs.length,
			warningCount: 0,
		},
		validationReportId: `dining_release_validation:${input.candidate.candidateId}:${Date.parse(
			now,
		).toString(36)}`,
		warnings: [],
	};
}

export function approveCandidate(input: {
	actor: DiningOpsActor;
	candidate: DiningReleaseCandidate;
	report: DiningReleaseCandidateValidationReport;
}): DiningReleaseCandidate {
	if (input.report.blockers.length > 0) {
		throwCandidateInvalid();
	}
	requireCandidateStatus(input.candidate, ["candidate", "validated", "approved"]);
	const now = new Date().toISOString();
	return {
		...input.candidate,
		approvedAt: now,
		approvedBy: input.actor.principalId,
		status: "approved",
	};
}

export function scheduleCandidate(input: {
	actor: DiningOpsActor;
	candidate: DiningReleaseCandidate;
	existingJobCount: number;
	scheduledAt: string;
}): { candidate: DiningReleaseCandidate; scheduleJob: DiningReleaseScheduleJob } {
	requireCandidateStatus(input.candidate, ["approved", "scheduled"]);
	const now = new Date().toISOString();
	return {
		candidate: {
			...input.candidate,
			publishMode: "scheduled",
			scheduledAt: input.scheduledAt,
			status: "scheduled",
		},
		scheduleJob: {
			attemptCount: 0,
			candidateId: input.candidate.candidateId,
			createdAt: now,
			createdBy: input.actor.principalId,
			executedAt: null,
			lastErrorCode: null,
			lastErrorMessage: null,
			scheduleJobId: `dining_release_schedule_job:${Date.parse(now).toString(36)}:${
				input.existingJobCount + 1
			}`,
			scheduledAt: input.scheduledAt,
			status: "scheduled",
		},
	};
}

export function publishCandidate(input: {
	actor: DiningOpsActor;
	candidate: DiningReleaseCandidate;
	report: DiningReleaseCandidateValidationReport;
	releaseCount: number;
	state: DiningOperationsState;
}): {
	candidate: DiningReleaseCandidate;
	latestPointer: DiningReleaseLatestPointer;
	release: DiningRelease;
	snapshot: DiningPublishedSnapshot;
} {
	requireCandidateStatus(input.candidate, ["approved", "scheduled"]);
	if (input.report.blockers.length > 0) {
		throwCandidateInvalid();
	}
	const frozenSnapshot = input.state.candidateSnapshots[input.candidate.candidateId];
	if (!frozenSnapshot) {
		throw new DiningDomainError({
			code: "dining_release_candidate_snapshot_missing",
			message: "Dining release candidate snapshot is missing.",
			retryable: false,
			status: 409,
		});
	}
	const now = new Date().toISOString();
	const releaseId = `dining_release:${Date.parse(now).toString(36)}:${input.releaseCount + 1}`;
	const snapshot = {
		...frozenSnapshot,
		source: {
			...frozenSnapshot.source,
			releaseId,
			updatedAt: now,
		},
	};
	const release: DiningRelease = {
		candidateId: input.candidate.candidateId,
		createdAt: now,
		createdBy: input.candidate.createdBy,
		notes: input.candidate.notes,
		predecessorReleaseId: input.candidate.expectedPredecessorReleaseId,
		publishedAt: now,
		publishedBy: input.actor.principalId,
		releaseId,
		snapshotHash: input.candidate.snapshotHash,
		status: "published",
	};
	return {
		candidate: {
			...input.candidate,
			publishedReleaseId: releaseId,
			status: "published",
		},
		latestPointer: {
			releaseId,
			scope: "global",
			snapshotId: `snapshot:${releaseId}`,
			updatedAt: now,
			updatedBy: input.actor.principalId,
		},
		release,
		snapshot,
	};
}

export function cancelCandidate(input: {
	actor: DiningOpsActor;
	candidate: DiningReleaseCandidate;
}): DiningReleaseCandidate {
	if (input.candidate.status === "published") {
		throw new DiningDomainError({
			code: "dining_release_candidate_already_published",
			message: "Published dining release candidate cannot be cancelled.",
			retryable: false,
			status: 409,
		});
	}
	const now = new Date().toISOString();
	return {
		...input.candidate,
		cancelledAt: now,
		cancelledBy: input.actor.principalId,
		status: "cancelled",
	};
}

export function requireReleaseCandidate(
	state: DiningOperationsState,
	candidateId: string,
): DiningReleaseCandidate {
	const candidate = state.releaseCandidates.find((item) => item.candidateId === candidateId);
	if (!candidate) {
		throw new DiningDomainError({
			code: "dining_release_candidate_not_found",
			message: "Dining release candidate was not found.",
			retryable: false,
			status: 404,
		});
	}
	return candidate;
}

export function requireRelease(state: DiningOperationsState, releaseId: string): DiningRelease {
	const release = state.releases.find((item) => item.releaseId === releaseId);
	if (!release) {
		throw new DiningDomainError({
			code: "dining_release_not_found",
			message: "Dining release was not found.",
			retryable: false,
			status: 404,
		});
	}
	return release;
}

export function requireCandidateStatus(
	candidate: DiningReleaseCandidate,
	allowed: DiningReleaseCandidateStatus[],
): void {
	if (!allowed.includes(candidate.status)) {
		throw new DiningDomainError({
			code: "dining_release_candidate_invalid_status",
			details: { status: candidate.status },
			message: "Dining release candidate status does not allow this command.",
			retryable: false,
			status: 409,
		});
	}
}

export function createInitialDraftVersion(): DiningDraftVersion {
	return createDiningDraftVersion({
		createdAt: DINING_SYSTEM_SOURCE.updatedAt,
		createdBy: "system:dining-domain",
		source: "initial",
	});
}

export function advanceDraftVersion(input: {
	actor: DiningOpsActor;
	state: DiningOperationsState;
	summary: Record<string, unknown>;
}): DiningDraftVersion {
	const versionNumber = input.state.currentDraftVersion.versionNumber + 1;
	return {
		createdAt: new Date().toISOString(),
		createdBy: input.actor.principalId,
		draftVersionId: `dining_draft_version:${versionNumber}`,
		summary: input.summary,
		versionNumber,
	};
}

export function reportForCandidate(
	state: DiningOperationsState,
	candidateId: string,
): DiningReleaseCandidateValidationReport | null {
	return (
		state.releaseCandidateValidationReports.find((report) => report.candidateId === candidateId) ??
		null
	);
}

function buildFloorplanRefs(state: DiningOperationsState): DiningFloorplanRef[] {
	return state.halls.flatMap((hall) =>
		hall.floors.map((floor) => {
			const manifest = resolveDiningFloorplanManifestRef({
				floorId: floor.floorId,
				hallId: hall.hallId,
			});
			const windows = state.windows.filter(
				(window) => window.hallId === hall.hallId && window.floorId === floor.floorId,
			);
			return {
				anchorInventory: manifest.anchorInventory,
				floorId: floor.floorId,
				floorplanId: floor.floorplanId,
				hallId: hall.hallId,
				sha256: floor.floorplanSha256,
				svgAssetUrl: floor.svgAssetUrl,
				windowBindings: windows.map((window) => ({
					svgAnchorId: window.svgAnchorId,
					windowId: window.windowId,
				})),
			};
		}),
	);
}

function validateFloorplanRef(input: {
	blockers: DiningReleaseValidationIssue[];
	ref: DiningFloorplanRef;
	snapshot: DiningPublishedSnapshot | undefined;
	state: DiningOperationsState;
}) {
	let manifest: DiningFloorplanManifestRef;
	try {
		manifest = resolveDiningFloorplanManifestRef(input.ref);
	} catch {
		input.blockers.push(
			issue("missing_floorplan_manifest", "Dining floor is missing floorplan manifest.", {
				floorId: input.ref.floorId,
				hallId: input.ref.hallId,
			}),
		);
		return;
	}
	if (
		manifest.floorplanId !== input.ref.floorplanId ||
		manifest.sha256 !== input.ref.sha256 ||
		manifest.svgAssetUrl !== input.ref.svgAssetUrl
	) {
		input.blockers.push(
			issue("floorplan_manifest_checksum_mismatch", "Floorplan manifest checksum mismatch.", {
				floorId: input.ref.floorId,
				floorplanId: input.ref.floorplanId,
			}),
		);
	}
	const manifestAnchorIds = manifest.anchorInventory.map((anchor) => anchor.anchorId);
	const refAnchorIds = input.ref.anchorInventory.map((anchor) => anchor.anchorId);
	if (manifestAnchorIds.join("\u0000") !== refAnchorIds.join("\u0000")) {
		input.blockers.push(
			issue("floorplan_manifest_checksum_mismatch", "Floorplan manifest anchors mismatch.", {
				floorId: input.ref.floorId,
				floorplanId: input.ref.floorplanId,
			}),
		);
	}
	const anchors = new Set(manifestAnchorIds);
	const bindings = input.ref.windowBindings.filter((binding) => binding.svgAnchorId);
	const duplicateBindings = findDuplicates(bindings.map((binding) => binding.svgAnchorId ?? ""));
	for (const svgAnchorId of duplicateBindings) {
		input.blockers.push(
			issue("duplicate_svg_anchor_binding", "SVG anchor is bound to multiple windows.", {
				floorId: input.ref.floorId,
				svgAnchorId,
			}),
		);
	}
	for (const binding of input.ref.windowBindings) {
		if (!binding.svgAnchorId) {
			input.blockers.push(
				issue("unbound_required_window", "Dining window is missing SVG anchor binding.", {
					windowId: binding.windowId,
				}),
			);
			continue;
		}
		if (!anchors.has(binding.svgAnchorId)) {
			input.blockers.push(
				issue("missing_svg_anchor", "Bound SVG anchor is missing from floorplan manifest.", {
					svgAnchorId: binding.svgAnchorId,
					windowId: binding.windowId,
				}),
			);
		}
	}
	const floor = input.snapshot?.floors[floorKey(input.ref)];
	if (floor?.floor.floorplan.sha256 !== input.ref.sha256) {
		input.blockers.push(
			issue("floorplan_manifest_checksum_mismatch", "Snapshot floorplan ref is stale.", {
				floorId: input.ref.floorId,
				floorplanId: input.ref.floorplanId,
			}),
		);
	}
}

function validateSnapshotProjection(input: {
	blockers: DiningReleaseValidationIssue[];
	snapshot: DiningPublishedSnapshot | undefined;
}) {
	if (!input.snapshot) {
		return;
	}
	for (const floor of Object.values(input.snapshot.floors)) {
		for (const assignment of floor.assignments) {
			if (!floor.stallProfiles.some((item) => item.stallProfileId === assignment.stallProfileId)) {
				input.blockers.push(
					issue(
						"missing_stall_profile_projection",
						"Snapshot assignment is missing stall profile.",
						{
							assignmentId: assignment.assignmentId,
						},
					),
				);
			}
		}
		for (const offering of floor.menuOfferings) {
			if (!floor.menuItems.some((item) => item.menuItemId === offering.menuItemId)) {
				input.blockers.push(
					issue("missing_menu_item_projection", "Snapshot offering is missing menu item.", {
						menuItemId: offering.menuItemId,
						offeringId: offering.offeringId,
					}),
				);
			}
		}
	}
}

function findDuplicates(values: string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			duplicates.add(value);
		}
		seen.add(value);
	}
	return [...duplicates].sort();
}

function issue(
	code: DiningReleaseValidationIssue["code"],
	message: string,
	ref: Record<string, string>,
): DiningReleaseValidationIssue {
	return { code, message, ref };
}

function throwCandidateInvalid(): never {
	throw new DiningDomainError({
		code: "dining_release_candidate_invalid",
		message: "Dining release candidate has validation blockers.",
		retryable: false,
		status: 409,
	});
}
