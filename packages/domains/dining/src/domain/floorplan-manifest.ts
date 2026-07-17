import { type DiningFloorplanManifestEntry, getDiningFloorplanByFloor } from "../floorplans";

import { DiningDomainError } from "./error";

export function resolveDiningFloorplanManifestRef(input: {
	floorId: string;
	hallId: string;
}): DiningFloorplanManifestEntry {
	return requireDiningFloorplanManifestEntry(input);
}

function requireDiningFloorplanManifestEntry(input: {
	floorId: string;
	hallId: string;
}): DiningFloorplanManifestEntry {
	try {
		return getDiningFloorplanByFloor(input);
	} catch (error) {
		throw new DiningDomainError({
			code: "dining_floorplan_manifest_missing",
			details: {
				floorId: input.floorId,
				hallId: input.hallId,
				reason: error instanceof Error ? error.message : "manifest_entry_missing",
			},
			message: "Dining floorplan manifest entry is missing.",
			retryable: false,
			status: 500,
		});
	}
}
