import { type DiningFloorplanManifestEntry, getDiningFloorplanByFloor } from "../floorplans";

import { DiningDomainError } from "./error";
import type { DiningFloorplanManifestRef } from "./release-types";

export function resolveDiningFloorplanManifestRef(input: {
	floorId: string;
	hallId: string;
}): DiningFloorplanManifestRef {
	const entry = requireDiningFloorplanManifestEntry(input);
	return {
		anchorInventory: entry.anchorInventory.map((anchor) => ({
			anchorId: anchor.anchorId,
			label: anchor.label,
			role: anchor.role,
		})),
		floorId: entry.floorId,
		floorplanId: entry.floorplanId,
		hallId: entry.hallId,
		sanitizedSvgMarkup: entry.svgMarkup,
		sha256: entry.sha256,
		svgAssetUrl: entry.svgAssetUrl,
	};
}

export function publicDiningFloorplanRef(
	ref: DiningFloorplanManifestRef,
): Omit<DiningFloorplanManifestRef, "sanitizedSvgMarkup"> {
	return {
		anchorInventory: ref.anchorInventory,
		floorId: ref.floorId,
		floorplanId: ref.floorplanId,
		hallId: ref.hallId,
		sha256: ref.sha256,
		svgAssetUrl: ref.svgAssetUrl,
	};
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
