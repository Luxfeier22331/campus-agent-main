import { DiningDomainError } from "./error";
import { resolveDiningFloorplanManifestRef } from "./floorplan-manifest";
import { sha256Tag, stableJson } from "./hash";
import { buildPublishedSnapshot } from "./projection";
import type {
	DiningPublication,
	DiningRelease,
	DiningValidationIssue,
	DiningValidationReport,
} from "./release-types";
import type {
	DiningDraft,
	DiningOpsActor,
	DiningPublishedSnapshot,
	DiningPublishResult,
} from "./types";

export function validateDiningDraft(
	draft: DiningDraft,
	now = new Date().toISOString(),
): DiningValidationReport {
	const blockers: DiningValidationIssue[] = [];
	const windowsById = new Map(draft.windows.map((window) => [window.windowId, window]));
	const stallsById = new Map(draft.stallProfiles.map((stall) => [stall.stallProfileId, stall]));
	const assignmentsById = new Map(
		draft.assignments.map((assignment) => [assignment.assignmentId, assignment]),
	);
	const itemsById = new Map(draft.menuItems.map((item) => [item.menuItemId, item]));

	for (const hall of draft.halls) {
		for (const floor of hall.floors) {
			const floorWindows = draft.windows.filter(
				(window) => window.hallId === hall.hallId && window.floorId === floor.floorId,
			);
			if (floor.floorplan.kind === "placeholder") {
				continue;
			}
			let manifest: ReturnType<typeof resolveDiningFloorplanManifestRef>;
			try {
				manifest = resolveDiningFloorplanManifestRef({
					floorId: floor.floorId,
					hallId: hall.hallId,
				});
			} catch {
				blockers.push(
					issue("missing_floorplan_manifest", "Floorplan manifest is missing.", {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				);
				continue;
			}
			if (manifest.floorplanId !== floor.floorplan.floorplanId) {
				blockers.push(
					issue("floorplan_manifest_mismatch", "Floorplan manifest reference changed.", {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				);
			}
			const manifestAnchors = new Set(
				manifest.anchorInventory
					.filter((anchor) => anchor.role === "window")
					.map((anchor) => anchor.anchorId),
			);
			const seen = new Set<string>();
			for (const window of floorWindows) {
				if (!(window.svgAnchorId && manifestAnchors.has(window.svgAnchorId))) {
					blockers.push(
						issue("missing_svg_anchor", "Window is not bound to this floorplan.", {
							windowId: window.windowId,
						}),
					);
					continue;
				}
				if (seen.has(window.svgAnchorId)) {
					blockers.push(
						issue("duplicate_svg_anchor_binding", "Floorplan anchor is bound more than once.", {
							svgAnchorId: window.svgAnchorId,
						}),
					);
				}
				seen.add(window.svgAnchorId);
			}
			for (const anchorId of manifestAnchors) {
				if (!seen.has(anchorId)) {
					blockers.push(
						issue("unbound_required_window", "Floorplan window has no catalog binding.", {
							floorId: floor.floorId,
							svgAnchorId: anchorId,
						}),
					);
				}
			}
		}
	}

	for (const assignment of draft.assignments) {
		if (!windowsById.has(assignment.windowId)) {
			blockers.push(
				issue("unbound_required_window", "Assignment references a missing window.", {
					assignmentId: assignment.assignmentId,
				}),
			);
		}
		if (!stallsById.has(assignment.stallProfileId)) {
			blockers.push(
				issue("missing_stall_profile_projection", "Assignment references a missing stall.", {
					assignmentId: assignment.assignmentId,
				}),
			);
		}
	}
	for (const offering of draft.menuOfferings) {
		if (!(assignmentsById.has(offering.assignmentId) && itemsById.has(offering.menuItemId))) {
			blockers.push(
				issue("missing_menu_item_projection", "Offering references missing catalog data.", {
					offeringId: offering.offeringId,
				}),
			);
		}
	}

	return {
		blockers,
		createdAt: now,
		draftRevision: draft.revision,
		status: blockers.length === 0 ? "pass" : "fail",
		summary: {
			assignmentCount: draft.assignments.length,
			blockerCount: blockers.length,
			hallCount: draft.halls.length,
			menuItemCount: draft.menuItems.length,
			warningCount: 0,
			windowCount: draft.windows.length,
		},
		warnings: [],
	};
}

export function publishDiningDraft(input: {
	actor: DiningOpsActor;
	draft: DiningDraft;
	notes: string;
	now?: string;
	releaseId?: string;
}): DiningPublishResult {
	const now = input.now ?? new Date().toISOString();
	const validation = validateDiningDraft(input.draft, now);
	if (validation.status === "fail") {
		throw new DiningDomainError({
			code: "dining_draft_invalid",
			details: { blockerCount: validation.blockers.length },
			message: "Dining draft validation failed.",
			retryable: false,
			status: 409,
		});
	}
	const releaseId = input.releaseId ?? `dining_release:${Date.parse(now).toString(36)}`;
	const snapshot = buildPublishedSnapshot(input.draft, releaseId, {
		label: "食堂发布数据",
		updatedAt: now,
	});
	const release: DiningRelease = {
		createdAt: now,
		createdBy: input.actor.principalId,
		draftRevision: input.draft.revision,
		notes: input.notes,
		predecessorReleaseId: input.draft.baseReleaseId,
		releaseId,
		rollbackOfReleaseId: null,
		snapshotHash: sha256Tag(stableJson(snapshot)),
		validation,
	};
	return {
		publication: { catalogReleaseId: releaseId, reviewRevision: 0, updatedAt: now },
		release,
		snapshot,
		validation,
	};
}

export function publicationAfterCatalogPublish(input: {
	current: DiningPublication;
	releaseId: string;
	updatedAt: string;
}): DiningPublication {
	return { ...input.current, catalogReleaseId: input.releaseId, updatedAt: input.updatedAt };
}

export function assertDiningSnapshotFloorplanCompatibility(
	snapshot: DiningPublishedSnapshot,
): void {
	const blockers: DiningValidationIssue[] = [];
	for (const hall of snapshot.halls) {
		for (const floor of hall.floors) {
			const projection = snapshot.floors[`${hall.hallId}:${floor.floorId}`];
			if (
				!projection ||
				projection.floor.floorplan.floorplanId !== floor.floorplan.floorplanId ||
				projection.floor.floorplan.kind !== floor.floorplan.kind
			) {
				blockers.push(
					issue("missing_floorplan_manifest", "Release floor projection is missing.", {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				);
				continue;
			}
			if (floor.floorplan.kind === "placeholder") {
				continue;
			}
			let manifest: ReturnType<typeof resolveDiningFloorplanManifestRef>;
			try {
				manifest = resolveDiningFloorplanManifestRef({
					floorId: floor.floorId,
					hallId: hall.hallId,
				});
			} catch {
				blockers.push(
					issue("missing_floorplan_manifest", "Floorplan manifest is missing.", {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				);
				continue;
			}
			if (manifest.floorplanId !== floor.floorplan.floorplanId) {
				blockers.push(
					issue("floorplan_manifest_mismatch", "Floorplan manifest reference changed.", {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				);
			}
			const available = new Set(
				manifest.anchorInventory
					.filter((anchor) => anchor.role === "window")
					.map((anchor) => anchor.anchorId),
			);
			const seen = new Set<string>();
			for (const window of projection.windows) {
				if (!(window.svgAnchorId && available.has(window.svgAnchorId))) {
					blockers.push(
						issue("missing_svg_anchor", "Release window is not bound to this floorplan.", {
							windowId: window.windowId,
						}),
					);
					continue;
				}
				if (seen.has(window.svgAnchorId)) {
					blockers.push(
						issue("duplicate_svg_anchor_binding", "Floorplan anchor is bound more than once.", {
							svgAnchorId: window.svgAnchorId,
						}),
					);
				}
				seen.add(window.svgAnchorId);
			}
		}
	}
	if (blockers.length > 0) {
		throw new DiningDomainError({
			code: "dining_rollback_floorplan_incompatible",
			details: { blockerCount: blockers.length },
			message: "Dining rollback snapshot is incompatible with the current floorplan manifest.",
			retryable: false,
			status: 409,
		});
	}
}

function issue(
	code: DiningValidationIssue["code"],
	message: string,
	ref: Record<string, string>,
): DiningValidationIssue {
	return { code, message, ref };
}
