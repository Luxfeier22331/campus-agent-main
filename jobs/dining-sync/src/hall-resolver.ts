import type { DiningOperationsState } from "dining-domain";

import {
	buildDiningStateFromCatalogObservations,
	canonicalHallName,
	normalizeCampusName,
} from "./catalog-source";
import type { DiningSourceObservation } from "./catalog-source-types";

export interface DiningHallResolution {
	hallId: string;
	hallName: string;
	stallProfileId: string;
	windowId: string;
}

export class CatalogDiningHallResolver {
	private readonly hallByKey = new Map<string, DiningOperationsState["halls"][number]>();
	private readonly stallByKey = new Map<string, DiningHallResolution | null>();

	static fromObservations(observations: DiningSourceObservation[]): CatalogDiningHallResolver {
		const catalogObservations = observations.filter(
			(observation) => observation.sourceType === "feishu_catalog",
		);
		if (catalogObservations.length === 0) {
			throw new Error("Dining review sync requires active Feishu catalog observations.");
		}
		return new CatalogDiningHallResolver(
			buildDiningStateFromCatalogObservations({
				observations: catalogObservations,
				source: {
					label: "Feishu 食堂采集",
					updatedAt: new Date().toISOString(),
				},
			}),
		);
	}

	constructor(state: DiningOperationsState) {
		if (state.halls.length === 0) {
			throw new Error("Dining review sync requires a catalog with at least one hall.");
		}
		for (const hall of state.halls) {
			this.hallByKey.set(hallKey(hall.campus, hall.name), hall);
		}

		const windowById = new Map(state.windows.map((window) => [window.windowId, window]));
		const stallProfileById = new Map(
			state.stallProfiles.map((profile) => [profile.stallProfileId, profile]),
		);
		const hallById = new Map(state.halls.map((hall) => [hall.hallId, hall]));
		for (const assignment of state.assignments) {
			const window = windowById.get(assignment.windowId);
			const stallProfile = stallProfileById.get(assignment.stallProfileId);
			if (!(window && stallProfile)) {
				throw new Error("Dining catalog resolver found an assignment without window or stall.");
			}
			const hall = hallById.get(window.hallId);
			if (!hall) {
				throw new Error("Dining catalog resolver found a window without hall.");
			}
			const key = stallKey(hall.hallId, stallProfile.displayName);
			const resolution = {
				hallId: hall.hallId,
				hallName: hall.name,
				stallProfileId: stallProfile.stallProfileId,
				windowId: window.windowId,
			};
			this.stallByKey.set(key, this.stallByKey.has(key) ? null : resolution);
		}
	}

	resolve(input: { campus: string; hallName: string; stallName: string }): DiningHallResolution | null {
		const hall = this.hallByKey.get(hallKey(input.campus, input.hallName));
		if (!hall) {
			return null;
		}
		return this.stallByKey.get(stallKey(hall.hallId, input.stallName)) ?? null;
	}
}

function hallKey(campus: string, hallName: string): string {
	return `${normalizeText(normalizeCampusName(campus))}:${normalizeText(canonicalHallName(hallName))}`;
}

function stallKey(hallId: string, stallName: string): string {
	return `${hallId}:${normalizeText(stallName)}`;
}

function normalizeText(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, "");
}
