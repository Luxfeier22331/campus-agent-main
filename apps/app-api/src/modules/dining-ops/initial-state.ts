import { resolveDiningFloorplanManifestRef } from "./floorplan-manifest";
import { sha256Tag, stableJson } from "./hash";
import {
	DINING_SOURCE,
	INITIAL_DINING_HALL_SEEDS,
	type InitialDiningHallSeed,
} from "./initial-data";
import { buildPublishedSnapshot } from "./projection";
import { createInitialDraftVersion } from "./release-lifecycle";
import type {
	DiningMenuItem,
	DiningMenuOffering,
	DiningOperationsState,
	DiningRelease,
	DiningStallProfile,
	DiningWindow,
	DiningWindowAssignment,
} from "./types";

export function createInitialDiningOperationsState(
	seeds: InitialDiningHallSeed[] = INITIAL_DINING_HALL_SEEDS,
): DiningOperationsState {
	const halls = seeds.map((hall) => ({
		campus: hall.campus,
		floors: hall.floors.map((floor) => {
			const floorplan = resolveDiningFloorplanManifestRef({
				floorId: floor.floorId,
				hallId: hall.hallId,
			});
			return {
				floorId: floor.floorId,
				floorplanId: floorplan.floorplanId,
				floorplanSha256: floorplan.sha256,
				label: floor.label,
				svgAssetUrl: floor.svgAssetUrl ?? floorplan.svgAssetUrl,
			};
		}),
		hallId: hall.hallId,
		name: hall.name,
		status: "active" as const,
	}));
	const windows = seeds.flatMap((hall) =>
		hall.floors.flatMap((floor) =>
			floor.stalls.map((stall, index) => ({
				floorId: floor.floorId,
				geometry: windowGeometry(index),
				hallId: hall.hallId,
				label: stall.name,
				locationLabel: stall.locationLabel,
				status: "active" as const,
				svgAnchorId: stall.svgAnchorId ?? svgAnchorIdFor(index),
				tags: stall.tags,
				windowId: windowIdFor(
					hall.hallId,
					floor.floorId,
					stall.windowIdSuffix ?? svgAnchorIdFor(index),
				),
			})),
		),
	);
	const stallProfiles: DiningStallProfile[] = [];
	const assignments: DiningWindowAssignment[] = [];
	const menuItems: DiningMenuItem[] = [];
	const menuOfferings: DiningMenuOffering[] = [];

	for (const hall of seeds) {
		for (const floor of hall.floors) {
			for (const [index, stall] of floor.stalls.entries()) {
				const windowId = windowIdFor(
					hall.hallId,
					floor.floorId,
					stall.windowIdSuffix ?? svgAnchorIdFor(index),
				);
				const assignmentId = `assignment:${hall.hallId}:${floor.floorId}:${windowId}`;
				const stallProfileId = `stall:${hall.hallId}:${floor.floorId}:${stall.id}`;
				stallProfiles.push({
					displayName: stall.name,
					stallProfileId,
					stallType: "seeded_food_window",
					status: "active",
					tags: stall.tags,
				});
				assignments.push({
					assignmentId,
					stallProfileId,
					status: "active",
					windowId,
				});
				for (const [offeringIndex, offering] of stall.offerings.entries()) {
					const menuItemId = `menu:${hall.hallId}:${floor.floorId}:${stall.id}:${offeringIndex + 1}`;
					menuItems.push({
						menuItemId,
						name: offering.name,
						status: "active",
						tags: offering.tags,
					});
					menuOfferings.push({
						assignmentId,
						menuItemId,
						offeringId: `offering:${assignmentId}:${menuItemId}`,
						priceLabel: offering.priceLabel,
						saleStatus: "available",
						specLabel: offering.specLabel,
					});
				}
			}
		}
	}
	const currentDraftVersion = createInitialDraftVersion();

	const draft: DiningOperationsState = {
		auditEvents: [],
		assignments,
		candidateSnapshots: {},
		currentDraftVersion,
		draftVersions: [currentDraftVersion],
		halls,
		menuItems,
		menuOfferings,
		publishedRelease: null,
		publishedSnapshot: null,
		releaseCandidateValidationReports: [],
		releaseCandidates: [],
		releaseLatestPointer: null,
		releaseScheduleJobs: [],
		releaseSnapshots: {},
		releases: [],
		stallProfiles,
		windows,
	};
	const snapshot = buildPublishedSnapshot(draft, "dining_release:initial", DINING_SOURCE);
	const release: DiningRelease = {
		candidateId: null,
		createdAt: DINING_SOURCE.updatedAt,
		createdBy: "system:initial-dining-seed",
		notes: "初始化校园食堂发布数据",
		predecessorReleaseId: null,
		publishedAt: DINING_SOURCE.updatedAt,
		publishedBy: "system:initial-dining-seed",
		releaseId: "dining_release:initial",
		snapshotHash: sha256Tag(stableJson(snapshot)),
		status: "published",
	};
	return {
		...draft,
		publishedRelease: release,
		publishedSnapshot: snapshot,
		releaseLatestPointer: {
			releaseId: release.releaseId,
			scope: "global",
			snapshotId: `snapshot:${release.releaseId}`,
			updatedAt: DINING_SOURCE.updatedAt,
			updatedBy: "system:initial-dining-seed",
		},
		releaseSnapshots: {
			[release.releaseId]: snapshot,
		},
		releases: [release],
	};
}

function windowGeometry(index: number): DiningWindow["geometry"] {
	const column = index % 3;
	const row = Math.floor(index / 3);
	return {
		height: 72,
		width: 150,
		x: 64 + column * 180,
		y: 72 + row * 112,
	};
}

function windowIdFor(hallId: string, floorId: string, suffix: string): string {
	return `${hallId}:${floorId}:${suffix}`;
}

function svgAnchorIdFor(index: number): string {
	return `window-${String(index + 1).padStart(2, "0")}`;
}
