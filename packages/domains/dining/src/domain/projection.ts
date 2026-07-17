import { DiningDomainError } from "./error";
import type {
	DiningCatalog,
	DiningMenuOffering,
	DiningOpsFloorResponse,
	DiningOpsHall,
	DiningPublishedFloorResponse,
	DiningPublishedSearchResponse,
	DiningPublishedSearchResult,
	DiningPublishedSnapshot,
} from "./types";

export function buildPublishedSnapshot(
	state: DiningCatalog,
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
	state: DiningCatalog,
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
			draftRevision:
				"revision" in state && typeof state.revision === "number" ? state.revision : undefined,
			floorId: floor.floorId,
			floorplan: floor.floorplan,
			hallId: hall.hallId,
			label: publicFloorLabel(hall.name, floor.label),
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
): DiningPublishedFloorResponse {
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
			floorId: floor.floor.floorId,
			floorplan: floor.floor.floorplan,
			hallId: floor.floor.hallId,
			label: floor.floor.label,
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
	}
	return {
		campus: hall.campus,
		floors: hall.floors.map((floor) => ({ floorId: floor.floorId, label: floor.label })),
		hallId: hall.hallId,
		name: hall.name,
		tags: uniqueStrings(
			floors.flatMap((floor) => (floor ? toPublicFloor(floor, snapshot.source).filters.tags : [])),
		),
	};
}

export function searchPublishedDiningSnapshot(
	snapshot: DiningPublishedSnapshot,
	input: { query: string; scopeHallId: string; tag: string | null },
): DiningPublishedSearchResponse {
	const scopeHall = snapshot.halls.find((hall) => hall.hallId === input.scopeHallId);
	if (!scopeHall) {
		throw new DiningDomainError({
			code: "dining_hall_not_found",
			message: "Dining hall projection was not found.",
			retryable: false,
			status: 404,
		});
	}
	const query = normalizeSearchText(input.query);
	const tag = input.tag ? normalizeSearchText(input.tag) : null;
	const ranked: Array<{
		currentHallRank: number;
		rank: number;
		result: DiningPublishedSearchResult;
	}> = [];

	for (const hall of snapshot.halls.filter((item) => item.campus === scopeHall.campus)) {
		for (const floorRef of hall.floors) {
			const floor = snapshot.floors[floorKey({ floorId: floorRef.floorId, hallId: hall.hallId })];
			if (!floor) {
				throwInvalidProjection("Dining search found a hall without its floor projection.");
			}
			const projection = toPublicFloor(floor, snapshot.source);
			for (const diningWindow of projection.windows) {
				const assignment = diningWindow.assignment;
				if (!assignment) {
					continue;
				}
				const sharedTags = uniqueStrings([...diningWindow.tags, ...assignment.stallProfile.tags]);
				const stallRank = query
					? bestSearchRank(query, [
							assignment.stallProfile.displayName,
							diningWindow.label,
							diningWindow.locationLabel,
							...sharedTags,
						])
					: null;
				let hasOfferingResult = false;
				for (const offering of assignment.offerings) {
					const offeringTags = uniqueStrings([...sharedTags, ...offering.tags]);
					if (tag && !offeringTags.some((value) => normalizeSearchText(value) === tag)) {
						continue;
					}
					const offeringRank = query
						? bestSearchRank(query, [offering.name, ...offering.tags])
						: tag
							? 6
							: null;
					if (offeringRank === null) {
						continue;
					}
					hasOfferingResult = true;
					ranked.push({
						currentHallRank: hall.hallId === scopeHall.hallId ? 0 : 1,
						rank: offeringRank,
						result: {
							campus: hall.campus,
							floorId: floorRef.floorId,
							floorLabel: floorRef.label,
							hallId: hall.hallId,
							hallName: hall.name,
							kind: "offering",
							offering: {
								offeringId: offering.offeringId,
								name: offering.name,
								priceLabel: offering.priceLabel,
							},
							resultId: `offering:${offering.offeringId}`,
							stallName: assignment.stallProfile.displayName,
							stallProfileId: assignment.stallProfile.stallProfileId,
							windowId: diningWindow.windowId,
							windowLabel: diningWindow.label,
						},
					});
				}
				const stallTagMatches =
					!tag || sharedTags.some((value) => normalizeSearchText(value) === tag);
				const shouldAddStall =
					stallTagMatches &&
					((query && stallRank !== null && !hasOfferingResult) ||
						(!query && Boolean(tag) && assignment.offerings.length === 0));
				if (shouldAddStall) {
					ranked.push({
						currentHallRank: hall.hallId === scopeHall.hallId ? 0 : 1,
						rank: stallRank === null ? 7 : stallRank + 3,
						result: {
							campus: hall.campus,
							floorId: floorRef.floorId,
							floorLabel: floorRef.label,
							hallId: hall.hallId,
							hallName: hall.name,
							kind: "stall",
							offering: null,
							resultId: `stall:${diningWindow.windowId}`,
							stallName: assignment.stallProfile.displayName,
							stallProfileId: assignment.stallProfile.stallProfileId,
							windowId: diningWindow.windowId,
							windowLabel: diningWindow.label,
						},
					});
				}
			}
		}
	}

	ranked.sort(
		(left, right) =>
			left.rank - right.rank ||
			left.currentHallRank - right.currentHallRank ||
			left.result.hallName.localeCompare(right.result.hallName, "zh-CN") ||
			left.result.floorLabel.localeCompare(right.result.floorLabel, "zh-CN") ||
			left.result.stallName.localeCompare(right.result.stallName, "zh-CN") ||
			(left.result.offering?.name ?? "").localeCompare(right.result.offering?.name ?? "", "zh-CN"),
	);
	return {
		results: ranked.slice(0, 20).map((item) => item.result),
		scope: { campus: scopeHall.campus, hallId: scopeHall.hallId },
		source: { updatedAt: snapshot.source.updatedAt },
		total: ranked.length,
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

function bestSearchRank(query: string, values: string[]): number | null {
	let best: number | null = null;
	for (const value of values) {
		const normalized = normalizeSearchText(value);
		const rank =
			normalized === query
				? 0
				: normalized.startsWith(query)
					? 1
					: normalized.includes(query)
						? 2
						: null;
		if (rank !== null && (best === null || rank < best)) {
			best = rank;
		}
	}
	return best;
}

function normalizeSearchText(value: string): string {
	return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function throwInvalidProjection(message: string): never {
	throw new DiningDomainError({
		code: "dining_projection_invalid",
		message,
		retryable: false,
		status: 500,
	});
}
