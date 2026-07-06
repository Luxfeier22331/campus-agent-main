import { DiningDomainError } from "./error";
import { publicDiningFloorplanRef, resolveDiningFloorplanManifestRef } from "./floorplan-manifest";
import { DINING_CANVAS } from "./state-factory";
import type {
	DiningMenuOffering,
	DiningOperationsService,
	DiningOperationsState,
	DiningOpsFloorResponse,
	DiningOpsHall,
	DiningPublishedSnapshot,
} from "./types";

export function buildPublishedSnapshot(
	state: DiningOperationsState,
	releaseId: string,
	source: Omit<DiningPublishedSnapshot["source"], "releaseId">,
): DiningPublishedSnapshot {
	const floors = Object.fromEntries(
		state.halls.flatMap((hall) =>
			hall.floors.map((floor) => {
				const key = floorKey({ floorId: floor.floorId, hallId: hall.hallId });
				return [
					key,
					buildFloorResponse(state, {
						floorId: floor.floorId,
						hallId: hall.hallId,
					}),
				];
			}),
		),
	);
	return {
		floors,
		halls: state.halls,
		source: {
			...source,
			releaseId,
		},
	};
}

export function buildFloorResponse(
	state: DiningOperationsState,
	input: { floorId: string; hallId: string },
): DiningOpsFloorResponse {
	const hall = state.halls.find((item) => item.hallId === input.hallId);
	const floor = hall?.floors.find((item) => item.floorId === input.floorId);
	if (!(hall && floor)) {
		throw new DiningDomainError({
			code: "dining_floor_not_found",
			message: "Dining floor projection was not found.",
			retryable: false,
			status: 404,
		});
	}
	const windows = state.windows.filter(
		(window) => window.hallId === input.hallId && window.floorId === input.floorId,
	);
	const floorplan = resolveDiningFloorplanManifestRef({
		floorId: floor.floorId,
		hallId: hall.hallId,
	});
	if (floor.floorplanId !== floorplan.floorplanId || floor.floorplanSha256 !== floorplan.sha256) {
		throw new DiningDomainError({
			code: "dining_floorplan_manifest_mismatch",
			details: {
				floorId: floor.floorId,
				floorplanId: floor.floorplanId,
				hallId: hall.hallId,
				manifestFloorplanId: floorplan.floorplanId,
				manifestSha256: floorplan.sha256,
				sha256: floor.floorplanSha256,
			},
			message: "Dining floorplan manifest reference does not match checked-in manifest.",
			retryable: false,
			status: 500,
		});
	}
	const windowIds = new Set(windows.map((window) => window.windowId));
	const assignments = state.assignments.filter((assignment) => windowIds.has(assignment.windowId));
	const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
	const stallProfileIds = new Set(assignments.map((assignment) => assignment.stallProfileId));
	const menuOfferings = state.menuOfferings.filter((offering) =>
		assignmentIds.has(offering.assignmentId),
	);
	const menuItemIds = new Set(menuOfferings.map((offering) => offering.menuItemId));
	return {
		assignments,
		floor: {
			canvas: DINING_CANVAS,
			draftVersionId: state.currentDraftVersion.draftVersionId,
			floorId: floor.floorId,
			floorplan: publicDiningFloorplanRef(floorplan),
			hallId: hall.hallId,
			label: publicFloorLabel(hall.name, floor.label),
			svgAssetUrl: floor.svgAssetUrl,
		},
		menuItems: state.menuItems.filter((item) => menuItemIds.has(item.menuItemId)),
		menuOfferings,
		stallProfiles: state.stallProfiles.filter((profile) =>
			stallProfileIds.has(profile.stallProfileId),
		),
		windows,
	};
}

export function toPublicFloor(
	floor: DiningOpsFloorResponse,
	source: DiningPublishedSnapshot["source"],
): Awaited<ReturnType<DiningOperationsService["getPublishedFloor"]>> {
	if (!floor.floor.canvas) {
		throwInvalidProjection("Dining floor projection is missing canvas geometry.");
	}
	if (
		!(
			floor.floor.svgAssetUrl.trim() || floor.floor.floorplan.floorplanId.startsWith("placeholder:")
		)
	) {
		throwInvalidProjection("Dining floor projection is missing SVG asset URL.");
	}
	if (!floor.floor.floorplan.sha256.trim()) {
		throwInvalidProjection("Dining floor projection is missing floorplan manifest checksum.");
	}
	const windows = floor.windows.map((window) => {
		const assignment = floor.assignments.find((item) => item.windowId === window.windowId);
		const stall = assignment
			? floor.stallProfiles.find((item) => item.stallProfileId === assignment.stallProfileId)
			: null;
		if (assignment && !stall) {
			throwInvalidProjection("Dining window assignment is missing stall profile.");
		}
		const offerings = assignment
			? floor.menuOfferings
					.filter(isPublicAssignmentOffering(assignment.assignmentId))
					.map((offering) => {
						const menuItem = floor.menuItems.find(
							(item) => item.menuItemId === offering.menuItemId,
						);
						if (!menuItem) {
							throwInvalidProjection("Dining menu offering is missing menu item.");
						}
						return {
							menuItemId: offering.menuItemId,
							name: menuItem.name,
							offeringId: offering.offeringId,
							priceLabel: offering.priceLabel,
							tags: menuItem.tags,
						};
					})
			: [];
		return {
			assignment:
				assignment && stall
					? {
							assignmentId: assignment.assignmentId,
							offerings,
							stallProfile: {
								displayName: stall.displayName,
								stallProfileId: stall.stallProfileId,
								stallType: stall.stallType,
								tags: stall.tags,
							},
						}
					: null,
			geometry: window.geometry,
			label: window.label,
			locationLabel: window.locationLabel,
			status: window.status,
			svgAnchorId: window.svgAnchorId,
			tags: uniqueStrings([
				...(stall?.tags ?? []),
				...window.tags,
				...offerings.flatMap((item) => item.tags),
			]),
			windowId: window.windowId,
		};
	});
	return {
		filters: {
			tags: uniqueStrings(windows.flatMap((window) => window.tags)),
		},
		floor: {
			canvas: floor.floor.canvas,
			floorId: floor.floor.floorId,
			floorplan: floor.floor.floorplan,
			hallId: floor.floor.hallId,
			label: floor.floor.label,
			svgAssetUrl: floor.floor.svgAssetUrl,
		},
		source: {
			updatedAt: source.updatedAt,
		},
		windows,
	};
}

export function toPublicHallSummary(hall: DiningOpsHall, snapshot: DiningPublishedSnapshot) {
	const floors = hall.floors.map(
		(floor) => snapshot.floors[floorKey({ floorId: floor.floorId, hallId: hall.hallId })],
	);
	for (const floor of floors) {
		if (!floor) {
			throwInvalidProjection("Dining hall summary is missing a floor projection.");
		}
		if (!(floor.floor.canvas && floor.floor.floorplan.sha256)) {
			throwInvalidProjection("Dining hall summary is missing floorplan projection fields.");
		}
		if (
			!(
				floor.floor.svgAssetUrl.trim() ||
				floor.floor.floorplan.floorplanId.startsWith("placeholder:")
			)
		) {
			throwInvalidProjection("Dining hall summary is missing floorplan asset URL.");
		}
	}
	return {
		campus: hall.campus,
		floors: hall.floors.map((floor) => ({ floorId: floor.floorId, label: floor.label })),
		hallId: hall.hallId,
		name: hall.name,
	};
}

export function floorKey(input: { floorId: string; hallId: string }): string {
	return `${input.hallId}:${input.floorId}`;
}

function publicFloorLabel(hallName: string, floorLabel: string): string {
	return floorLabel === "地图" ? hallName : `${hallName}${floorLabel}`;
}

function isPublicAssignmentOffering(assignmentId: string) {
	return (offering: DiningMenuOffering): boolean => offering.assignmentId === assignmentId;
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))].sort(
		(left, right) => left.localeCompare(right, "zh-CN"),
	);
}

function throwInvalidProjection(message: string): never {
	throw new DiningDomainError({
		code: "dining_projection_invalid",
		message,
		retryable: false,
		status: 500,
	});
}
