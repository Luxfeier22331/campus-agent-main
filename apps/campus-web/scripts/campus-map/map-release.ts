import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	canonicalJsonBytes,
	digestFromManifestEntry,
	isBounds,
	isInsideBounds,
	readFileBytes,
	readJson,
	readSafeInteger,
	readString,
	relativeAssetPath,
	sameBounds,
	sha256,
	visitCoordinates,
} from "./map-format";
import { ASSET_ROOT, CAMPUS_CONFIG, type CampusId, DATA_ROOT, type Manifest } from "./map-model";
import { normalizeGeoJson, normalizePlaces } from "./map-normalize";
import {
	commitStagedFiles,
	commitStagedManifest,
	copyAssetFiles,
	createStageRoot,
	readExistingManifest,
	writeStageFile,
} from "./map-staging";

export function normalizeCampusMapAssets(
	input: { campus?: CampusId; dataRoot?: string; assetRoot?: string } = {},
): { geojsonDigests: Record<CampusId, string>; placesDigest: string } {
	const dataRoot = resolve(input.dataRoot ?? DATA_ROOT);
	const assetRoot = resolve(input.assetRoot ?? ASSET_ROOT);
	const requestedCampuses = input.campus
		? [input.campus]
		: (Object.keys(CAMPUS_CONFIG) as CampusId[]);
	const existingManifest = readExistingManifest(assetRoot);
	if (existingManifest) {
		validateCampusMapAssets(assetRoot);
	}
	const geojsonDigests: Partial<Manifest["campuses"]> = existingManifest?.campuses ?? {};
	const nextGeojsonDigests: Record<CampusId, string> = {
		fengtai: digestFromManifestEntry(geojsonDigests.fengtai?.geojsonUrl),
		haidian: digestFromManifestEntry(geojsonDigests.haidian?.geojsonUrl),
	};
	const campuses = existingManifest
		? requestedCampuses
		: (Object.keys(CAMPUS_CONFIG) as CampusId[]);
	const stageRoot = createStageRoot(assetRoot);
	const stagedFiles: string[] = [];
	try {
		if (existingManifest) {
			copyAssetFiles(assetRoot, stageRoot);
		} else {
			mkdirSync(resolve(stageRoot, "assets"), { recursive: true });
			mkdirSync(resolve(stageRoot, "places"), { recursive: true });
		}
		for (const campus of campuses) {
			const source = readJson(resolve(dataRoot, "curated", `${campus}.geojson`));
			const normalized = normalizeGeoJson(source, campus);
			const bytes = canonicalJsonBytes(normalized);
			const digest = sha256(bytes);
			const relativePath = join("assets", `${digest}.geojson`);
			writeStageFile(stageRoot, relativePath, bytes);
			stagedFiles.push(relativePath);
			nextGeojsonDigests[campus] = digest;
		}

		if (Object.values(nextGeojsonDigests).some((digest) => !/^[0-9a-f]{64}$/u.test(digest))) {
			throw new Error("Campus map normalization did not produce both campus GeoJSON assets.");
		}
		const places = normalizePlaces(readJson(resolve(dataRoot, "places.source.json")));
		const placesBytes = canonicalJsonBytes(places);
		const placesDigest = sha256(placesBytes);
		const placesPath = join("places", `${placesDigest}.json`);
		writeStageFile(stageRoot, placesPath, placesBytes);
		stagedFiles.push(placesPath);

		const manifest: Manifest = {
			attribution: [
				'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
			],
			campuses: {
				fengtai: {
					bounds: CAMPUS_CONFIG.fengtai.bounds,
					geojsonUrl: `/campus-map/assets/${nextGeojsonDigests.fengtai}.geojson`,
					name: CAMPUS_CONFIG.fengtai.name,
				},
				haidian: {
					bounds: CAMPUS_CONFIG.haidian.bounds,
					geojsonUrl: `/campus-map/assets/${nextGeojsonDigests.haidian}.geojson`,
					name: CAMPUS_CONFIG.haidian.name,
				},
			},
			licenseBoundary:
				"Campus GeoJSON is derived from OpenStreetMap data under ODbL 1.0 and is not covered by the repository Apache-2.0 license.",
			placesUrl: `/campus-map/places/${placesDigest}.json`,
		};
		writeStageFile(stageRoot, "manifest.json", canonicalJsonBytes(manifest));
		validateCampusMapAssets(stageRoot);
		commitStagedFiles(stageRoot, assetRoot, stagedFiles);
		commitStagedManifest(stageRoot, assetRoot);
		return { geojsonDigests: nextGeojsonDigests, placesDigest };
	} finally {
		rmSync(stageRoot, { force: true, recursive: true });
	}
}

export function validateCampusMapAssets(assetRoot = ASSET_ROOT): void {
	const root = resolve(assetRoot);
	const manifest = readJson(resolve(root, "manifest.json")) as Manifest;
	validateManifest(manifest, root);
	const placesPath = resolve(root, relativeAssetPath(manifest.placesUrl));
	const places = normalizePlaces(readJson(placesPath));
	const featureKeys = new Set<string>();
	for (const [campusId, campus] of Object.entries(manifest.campuses) as [
		CampusId,
		Manifest["campuses"][CampusId],
	][]) {
		const digest = digestFromManifestEntry(campus.geojsonUrl);
		const assetPath = resolve(root, "assets", `${digest}.geojson`);
		const bytes = readFileBytes(assetPath);
		if (sha256(bytes) !== digest) {
			throw new Error(`GeoJSON digest mismatch for ${campusId}.`);
		}
		const collection = normalizeGeoJson(JSON.parse(new TextDecoder().decode(bytes)), campusId);
		let boundaryFeatures = 0;
		for (const feature of collection.features) {
			const layer = readString(feature.properties.layer);
			const fid = readSafeInteger(feature.properties.fid);
			if (!layer || fid === null) {
				throw new Error(`Invalid feature identity in ${campusId}.`);
			}

			const key = `${campusId}:${layer}:${fid}`;
			if (featureKeys.has(key)) {
				throw new Error(`Duplicate feature identity: ${key}`);
			}
			featureKeys.add(key);
			if (layer === "boundary") {
				boundaryFeatures += 1;
			}
			visitCoordinates(feature.geometry.coordinates, (coordinate) => {
				if (!isInsideBounds(coordinate, campus.bounds)) {
					throw new Error(`Feature ${key} is outside ${campusId} bounds.`);
				}
			});
		}
		if (boundaryFeatures === 0) {
			throw new Error(`Missing campus boundary feature: ${campusId}.`);
		}
	}
	const referenced = new Set<string>();
	for (const place of places.places) {
		if (place.mapFeatureRefs) {
			for (const ref of place.mapFeatureRefs) {
				const key = `${ref.sourceId.replace(/-campus$/, "")}:${ref.layer}:${ref.fid}`;
				if (!featureKeys.has(key)) {
					throw new Error(`${place.id} references missing feature ${key}.`);
				}
				if (referenced.has(key)) {
					throw new Error(`Feature is referenced more than once: ${key}`);
				}
				referenced.add(key);
			}
		}
	}
}

export function validateCampusMapRelease(
	input: { assetRoot?: string; dataRoot?: string } = {},
): void {
	const assetRoot = resolve(input.assetRoot ?? ASSET_ROOT);
	const dataRoot = resolve(input.dataRoot ?? DATA_ROOT);
	validateCampusMapAssets(assetRoot);
	const manifest = readJson(resolve(assetRoot, "manifest.json")) as Manifest;
	for (const campus of Object.keys(CAMPUS_CONFIG) as CampusId[]) {
		const source = readJson(resolve(dataRoot, "curated", `${campus}.geojson`));
		const digest = sha256(canonicalJsonBytes(normalizeGeoJson(source, campus)));
		const expectedUrl = `/campus-map/assets/${digest}.geojson`;
		if (manifest.campuses[campus].geojsonUrl !== expectedUrl) {
			throw new Error(`Curated source digest does not match the published ${campus} asset.`);
		}
	}
	const places = normalizePlaces(readJson(resolve(dataRoot, "places.source.json")));
	const placesDigest = sha256(canonicalJsonBytes(places));
	if (manifest.placesUrl !== `/campus-map/places/${placesDigest}.json`) {
		throw new Error("Places source digest does not match the published asset.");
	}
}

function validateManifest(manifest: Manifest, assetRoot: string): void {
	if (!Array.isArray(manifest.attribution) || manifest.attribution.length === 0) {
		throw new Error("Map manifest attribution is invalid.");
	}
	if (!manifest.licenseBoundary.includes("ODbL 1.0")) {
		throw new Error("Map manifest license boundary is invalid.");
	}
	if (!/^\/campus-map\/places\/[0-9a-f]{64}\.json$/u.test(manifest.placesUrl)) {
		throw new Error("Map manifest placesUrl is invalid.");
	}
	const placesDigest = manifest.placesUrl.split("/").at(-1)?.replace(".json", "");
	if (!placesDigest) {
		throw new Error("Map manifest placesUrl is missing.");
	}
	const placesBytes = readFileBytes(resolve(assetRoot, relativeAssetPath(manifest.placesUrl)));
	if (sha256(placesBytes) !== placesDigest) {
		throw new Error("Places digest mismatch.");
	}
	for (const campusId of Object.keys(CAMPUS_CONFIG) as CampusId[]) {
		const campus = manifest.campuses?.[campusId];
		if (
			!(campus && /^\/campus-map\/assets\/[0-9a-f]{64}\.geojson$/u.test(campus.geojsonUrl)) ||
			campus.name !== CAMPUS_CONFIG[campusId].name ||
			!isBounds(campus.bounds) ||
			!sameBounds(campus.bounds, CAMPUS_CONFIG[campusId].bounds)
		) {
			throw new Error(`Map manifest campus entry is invalid: ${campusId}.`);
		}
	}
}
