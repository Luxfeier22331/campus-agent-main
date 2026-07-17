import type { DiningPublishedSnapshot } from "@campus-agent/dining/domain";

import { canonicalHallName, normalizeCampusName } from "./catalog-source";

export type DiningReviewResolution =
	| {
			hallId: string;
			hallName: string;
			offeringId: string;
			stallProfileId: string;
			status: "resolved";
			windowId: string;
	  }
	| {
			reason:
				| "hall_not_found"
				| "offering_ambiguous"
				| "offering_not_found"
				| "stall_ambiguous"
				| "stall_not_found";
			status: "blocked";
	  };

interface ResolvedStall {
	assignmentId: string;
	hallId: string;
	hallName: string;
	stallProfileId: string;
	windowId: string;
}

interface ResolvedOffering {
	offeringId: string;
}

export class PublishedDiningReviewResolver {
	private readonly hallIdsByKey = new Map<string, string[]>();
	private readonly offeringsByKey = new Map<string, ResolvedOffering[]>();
	private readonly stallsByKey = new Map<string, ResolvedStall[]>();

	constructor(snapshot: DiningPublishedSnapshot) {
		for (const hall of snapshot.halls) {
			appendMapValue(this.hallIdsByKey, hallKey(hall.campus, hall.name), hall.hallId);
			for (const floorRef of hall.floors) {
				const floor = snapshot.floors[`${hall.hallId}:${floorRef.floorId}`];
				if (!floor) {
					throw new Error("Dining review resolver found a hall without its published floor.");
				}
				const windowById = new Map(floor.windows.map((window) => [window.windowId, window]));
				const profileById = new Map(
					floor.stallProfiles.map((profile) => [profile.stallProfileId, profile]),
				);
				const itemById = new Map(floor.menuItems.map((item) => [item.menuItemId, item]));
				for (const assignment of floor.assignments) {
					const diningWindow = windowById.get(assignment.windowId);
					const profile = profileById.get(assignment.stallProfileId);
					if (!(diningWindow && profile)) {
						throw new Error("Dining review resolver found an incomplete published assignment.");
					}
					const stall: ResolvedStall = {
						assignmentId: assignment.assignmentId,
						hallId: hall.hallId,
						hallName: hall.name,
						stallProfileId: profile.stallProfileId,
						windowId: diningWindow.windowId,
					};
					appendMapValue(this.stallsByKey, stallKey(hall.hallId, profile.displayName), stall);
					for (const offering of floor.menuOfferings.filter(
						(item) => item.assignmentId === assignment.assignmentId,
					)) {
						const menuItem = itemById.get(offering.menuItemId);
						if (!menuItem) {
							throw new Error("Dining review resolver found an offering without its menu item.");
						}
						appendMapValue(
							this.offeringsByKey,
							offeringKey(assignment.assignmentId, menuItem.name),
							{ offeringId: offering.offeringId },
						);
					}
				}
			}
		}
	}

	resolve(input: {
		campus: string;
		dishName: string;
		hallName: string;
		stallName: string;
	}): DiningReviewResolution {
		const hallIds = this.hallIdsByKey.get(hallKey(input.campus, input.hallName)) ?? [];
		if (hallIds.length !== 1) {
			return { reason: "hall_not_found", status: "blocked" };
		}
		const hallId = hallIds[0];
		if (!hallId) {
			return { reason: "hall_not_found", status: "blocked" };
		}
		const stalls = this.stallsByKey.get(stallKey(hallId, input.stallName)) ?? [];
		if (stalls.length === 0) {
			return { reason: "stall_not_found", status: "blocked" };
		}
		if (stalls.length > 1) {
			return { reason: "stall_ambiguous", status: "blocked" };
		}
		const stall = stalls[0];
		if (!stall) {
			return { reason: "stall_not_found", status: "blocked" };
		}
		const offerings =
			this.offeringsByKey.get(offeringKey(stall.assignmentId, input.dishName)) ?? [];
		if (offerings.length === 0) {
			return { reason: "offering_not_found", status: "blocked" };
		}
		if (offerings.length > 1) {
			return { reason: "offering_ambiguous", status: "blocked" };
		}
		const offering = offerings[0];
		if (!offering) {
			return { reason: "offering_not_found", status: "blocked" };
		}
		return {
			hallId: stall.hallId,
			hallName: stall.hallName,
			offeringId: offering.offeringId,
			stallProfileId: stall.stallProfileId,
			status: "resolved",
			windowId: stall.windowId,
		};
	}
}

function hallKey(campus: string, hallName: string): string {
	return `${normalizeText(normalizeCampusName(campus))}:${normalizeText(canonicalHallName(hallName))}`;
}

function stallKey(hallId: string, stallName: string): string {
	return `${hallId}:${normalizeText(stallName)}`;
}

function offeringKey(assignmentId: string, dishName: string): string {
	return `${assignmentId}:${normalizeText(dishName)}`;
}

function normalizeText(value: string): string {
	return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function appendMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
	const values = map.get(key) ?? [];
	values.push(value);
	map.set(key, values);
}
