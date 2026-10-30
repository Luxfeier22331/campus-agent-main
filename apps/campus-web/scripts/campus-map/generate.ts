import { pathToFileURL } from "node:url";
import { CAMPUS_CONFIG, type CampusId } from "./map-model.ts";
import { normalizeCampusMapAssets, validateCampusMapRelease } from "./map-release.ts";
import { updateCampusMapSnapshot } from "./map-snapshot.ts";

export type {
	Bounds,
	CampusId,
	GeoJsonCollection,
	GeoJsonFeature,
	Manifest,
	OsmSnapshot,
	Place,
	PlaceFeatureRef,
	PlacesDocument,
} from "./map-model.ts";
export {
	normalizeCampusMapAssets,
	validateCampusMapAssets,
	validateCampusMapRelease,
} from "./map-release.ts";
export { updateCampusMapSnapshot } from "./map-snapshot.ts";

export function parseCampusMapCommandArgs(argv: string[]): {
	campus?: CampusId;
	mode: "normalize" | "snapshot-update" | "validate";
} {
	let mode: "normalize" | "snapshot-update" | "validate" | null = null;
	let campus: CampusId | undefined;
	for (const token of argv) {
		if (token === "--") {
			continue;
		}
		if (token === "--normalize" || token === "--snapshot-update" || token === "--validate") {
			if (mode) {
				throw new Error("Only one map command mode may be selected.");
			}
			mode = token.slice(2) as "normalize" | "snapshot-update" | "validate";
			continue;
		}
		if (token === "--campus") {
			throw new Error("--campus requires a value; use --campus=fengtai or --campus=haidian.");
		}
		if (token.startsWith("--campus=")) {
			const value = token.slice("--campus=".length) as CampusId;
			if (!(value in CAMPUS_CONFIG)) {
				throw new Error(`Unknown campus: ${value}`);
			}
			campus = value;
			continue;
		}
		throw new Error(`Unknown campus map argument: ${token}`);
	}
	if (!mode) {
		throw new Error("One of --normalize, --snapshot-update, or --validate is required.");
	}
	if (mode === "snapshot-update" && !campus) {
		throw new Error("--snapshot-update requires --campus=fengtai or --campus=haidian.");
	}
	return { ...(campus ? { campus } : {}), mode };
}

async function main(): Promise<void> {
	const args = parseCampusMapCommandArgs(process.argv.slice(2));
	if (args.mode === "normalize") {
		console.log(JSON.stringify(normalizeCampusMapAssets({ campus: args.campus }), null, "\t"));
		return;
	}
	if (args.mode === "validate") {
		validateCampusMapRelease();
		console.log("campus map assets valid");
		return;
	}
	await updateCampusMapSnapshot(args.campus as CampusId);
	console.log(`updated campus map snapshot: ${args.campus}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
