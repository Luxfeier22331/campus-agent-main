import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = resolve(APP_ROOT, "data/campus-map");
const ASSET_ROOT = resolve(APP_ROOT, "assets/campus-map");

const CAMPUS_CONFIG = {
	fengtai: {
		bounds: [116.1051993, 39.8063459, 116.1159622, 39.8136322],
		name: "丰台校区",
		sourceId: "fengtai-campus",
	},
	haidian: {
		bounds: [116.3084827, 39.9444838, 116.3194888, 39.9556239],
		name: "海淀校区",
		sourceId: "haidian-campus",
	},
} as const;

type CampusId = keyof typeof CAMPUS_CONFIG;
type Bounds = readonly [number, number, number, number];
type JsonObject = Record<string, unknown>;

interface GeoJsonFeature {
	geometry: { coordinates: unknown; type: string };
	properties: JsonObject;
	type: "Feature";
}

interface GeoJsonCollection {
	features: GeoJsonFeature[];
	type: "FeatureCollection";
}

interface PlaceFeatureRef {
	fid: number;
	layer: "boundary" | "building" | "sport";
	sourceId: string;
}

interface Place {
	accessNote: string | null;
	campus: string;
	category: "building" | "gate" | "landmark" | "service" | "transport";
	description: string;
	geojson: {
		geometry: { coordinates: [number, number]; type: "Point" };
		properties: { category: string; placeId: string; title: string };
		type: "Feature";
	};
	id: string;
	mapFeatureRefs?: PlaceFeatureRef[];
	sourceRefs: string[];
	tags: string[];
	title: string;
}

interface PlacesDocument {
	campus: { defaultCenter: [number, number]; id: string; name: string };
	places: Place[];
}

interface Manifest {
	attribution: string[];
	campuses: Record<CampusId, { bounds: Bounds; geojsonUrl: string; name: string }>;
	licenseBoundary: string;
	placesUrl: string;
}

interface OsmSnapshot {
	elements: unknown[];
}

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

function isPlaceCategory(value: unknown): value is Place["category"] {
	return (
		value === "building" ||
		value === "gate" ||
		value === "landmark" ||
		value === "service" ||
		value === "transport"
	);
}

function sameBounds(left: readonly number[], right: Bounds): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isBounds(value: unknown): value is Bounds {
	return (
		Array.isArray(value) &&
		value.length === 4 &&
		value.every((item) => typeof item === "number" && Number.isFinite(item)) &&
		value[0] < value[2] &&
		value[1] < value[3]
	);
}

function normalizeGeoJson(value: unknown, campus: CampusId): GeoJsonCollection {
	if (!isObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
		throw new Error(`Invalid GeoJSON FeatureCollection for ${campus}.`);
	}
	const identities = new Set<string>();
	const features = value.features.map((feature, index) => {
		if (!isObject(feature) || feature.type !== "Feature" || !isObject(feature.properties)) {
			throw new Error(`Invalid GeoJSON feature ${campus}:${index}.`);
		}
		const layer = readString(feature.properties.layer);
		const fid = readSafeInteger(feature.properties.fid);
		if (!layer || fid === null) {
			throw new Error(`Missing feature identity ${campus}:${index}.`);
		}
		const identity = `${layer}:${fid}`;
		if (identities.has(identity)) {
			throw new Error(`Duplicate feature identity: ${campus}:${identity}`);
		}
		identities.add(identity);
		if (!["boundary", "building", "green", "roadp", "sport"].includes(layer)) {
			throw new Error(`Unsupported map layer ${layer}.`);
		}
		if (!isObject(feature.geometry) || typeof feature.geometry.type !== "string") {
			throw new Error(`Invalid feature geometry ${campus}:${fid}.`);
		}
		visitCoordinates(feature.geometry.coordinates, () => undefined);
		return {
			geometry: feature.geometry as GeoJsonFeature["geometry"],
			properties: feature.properties,
			type: "Feature" as const,
		};
	});
	features.sort((left, right) => {
		const layerLeft = String(left.properties.layer);
		const layerRight = String(right.properties.layer);
		const layerCompare = layerLeft < layerRight ? -1 : layerLeft > layerRight ? 1 : 0;
		return layerCompare || Number(left.properties.fid) - Number(right.properties.fid);
	});
	return { features, type: "FeatureCollection" };
}

function normalizePlaces(value: unknown): PlacesDocument {
	if (!(isObject(value) && isObject(value.campus) && Array.isArray(value.places))) {
		throw new Error("Invalid campus map places document.");
	}
	const campus = value.campus;
	if (
		typeof campus.id !== "string" ||
		typeof campus.name !== "string" ||
		!Array.isArray(campus.defaultCenter) ||
		campus.defaultCenter.length !== 2 ||
		!campus.defaultCenter.every((item) => typeof item === "number" && Number.isFinite(item))
	) {
		throw new Error("Invalid campus map places campus metadata.");
	}
	const ids = new Set<string>();
	const places = value.places.map((item, index) => {
		if (!isObject(item) || typeof item.id !== "string" || !item.id || ids.has(item.id)) {
			throw new Error(`Invalid or duplicate place id at index ${index}.`);
		}
		ids.add(item.id);
		const campusName = readString(item.campus);
		const campusConfig = campusName ? getCampusConfigByName(campusName) : null;
		if (
			typeof item.campus !== "string" ||
			!campusConfig ||
			!isPlaceCategory(item.category) ||
			typeof item.title !== "string" ||
			item.title.trim().length === 0 ||
			typeof item.description !== "string" ||
			item.description.trim().length === 0 ||
			(item.accessNote !== null && typeof item.accessNote !== "string") ||
			!Array.isArray(item.sourceRefs) ||
			item.sourceRefs.length === 0 ||
			!item.sourceRefs.every((ref) => typeof ref === "string") ||
			!Array.isArray(item.tags) ||
			!item.tags.every((tag) => typeof tag === "string") ||
			!isObject(item.geojson) ||
			item.geojson.type !== "Feature" ||
			!isObject(item.geojson.geometry) ||
			item.geojson.geometry.type !== "Point" ||
			!Array.isArray(item.geojson.geometry.coordinates) ||
			item.geojson.geometry.coordinates.length !== 2
		) {
			throw new Error(`Invalid place document: ${item.id}.`);
		}
		const coordinates = item.geojson.geometry.coordinates;
		if (
			!coordinates.every(
				(coordinate, coordinateIndex) =>
					typeof coordinate === "number" &&
					Number.isFinite(coordinate) &&
					(coordinateIndex === 0
						? coordinate >= -180 && coordinate <= 180
						: coordinate >= -90 && coordinate <= 90),
			)
		) {
			throw new Error(`Invalid place coordinates: ${item.id}.`);
		}
		if (
			!(
				isInsideBounds(coordinates as [number, number], campusConfig.bounds) ||
				(item.category === "transport" && !item.mapFeatureRefs)
			)
		) {
			throw new Error(`Place ${item.id} is outside ${campusName} bounds.`);
		}
		if (
			!isObject(item.geojson.properties) ||
			item.geojson.properties.placeId !== item.id ||
			item.geojson.properties.title !== item.title ||
			item.geojson.properties.category !== item.category
		) {
			throw new Error(`Place GeoJSON properties do not match ${item.id}.`);
		}
		if (item.mapFeatureRefs !== undefined) {
			if (!Array.isArray(item.mapFeatureRefs)) {
				throw new Error(`Invalid feature references: ${item.id}.`);
			}
			for (const ref of item.mapFeatureRefs) {
				if (
					!isObject(ref) ||
					readSafeInteger(ref.fid) === null ||
					!isMapFeatureLayer(ref.layer) ||
					ref.sourceId !== campusConfig.sourceId
				) {
					throw new Error(`Invalid feature reference: ${item.id}.`);
				}
			}
		}
		return item as unknown as Place;
	});
	return {
		campus: {
			defaultCenter: campus.defaultCenter as [number, number],
			id: campus.id,
			name: campus.name,
		},
		places,
	};
}

function getCampusConfigByName(name: string): (typeof CAMPUS_CONFIG)[CampusId] | null {
	for (const campus of Object.values(CAMPUS_CONFIG)) {
		if (campus.name === name) {
			return campus;
		}
	}
	return null;
}

function isMapFeatureLayer(value: unknown): value is PlaceFeatureRef["layer"] {
	return value === "boundary" || value === "building" || value === "sport";
}

function createStageRoot(assetRoot: string): string {
	mkdirSync(dirname(assetRoot), { recursive: true });
	return mkdtempSync(join(dirname(assetRoot), ".campus-map-assets-"));
}

function copyAssetFiles(sourceRoot: string, targetRoot: string): void {
	for (const directory of ["assets", "places"] as const) {
		const sourceDirectory = resolve(sourceRoot, directory);
		if (!existsSync(sourceDirectory)) {
			throw new Error(`Campus map asset directory is missing: ${sourceDirectory}`);
		}
		mkdirSync(resolve(targetRoot, directory), { recursive: true });
		for (const name of readDirectoryNames(sourceDirectory)) {
			copyFileSync(resolve(sourceDirectory, name), resolve(targetRoot, directory, name));
		}
	}
	copyFileSync(resolve(sourceRoot, "manifest.json"), resolve(targetRoot, "manifest.json"));
}

function readDirectoryNames(directory: string): string[] {
	return readdirSync(directory);
}

function writeStageFile(stageRoot: string, relativePath: string, bytes: Uint8Array): void {
	const filePath = resolve(stageRoot, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, bytes);
}

function commitStagedFiles(
	stageRoot: string,
	assetRoot: string,
	relativePaths: readonly string[],
): void {
	for (const relativePath of new Set(relativePaths)) {
		const sourcePath = resolve(stageRoot, relativePath);
		const targetPath = resolve(assetRoot, relativePath);
		mkdirSync(dirname(targetPath), { recursive: true });
		if (existsSync(targetPath)) {
			if (sha256(readFileBytes(sourcePath)) !== sha256(readFileBytes(targetPath))) {
				throw new Error(
					`Content-addressed asset already exists with different bytes: ${relativePath}`,
				);
			}
			rmSync(sourcePath, { force: true });
			continue;
		}
		renameSync(sourcePath, targetPath);
	}
}

function commitStagedManifest(stageRoot: string, assetRoot: string): void {
	mkdirSync(assetRoot, { recursive: true });
	renameSync(resolve(stageRoot, "manifest.json"), resolve(assetRoot, "manifest.json"));
}

function readExistingManifest(assetRoot: string): Manifest | null {
	const manifestPath = resolve(assetRoot, "manifest.json");
	try {
		return readJson(manifestPath) as Manifest;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			(error as { code?: unknown }).code === "ENOENT"
		) {
			return null;
		}
		throw new Error(`Existing campus map manifest is invalid: ${manifestPath}`, { cause: error });
	}
}

function digestFromManifestEntry(url: string | undefined): string {
	const digest = url?.match(/[0-9a-f]{64}/u)?.[0];
	return digest ?? "";
}

function relativeAssetPath(url: string): string {
	const prefix = "/campus-map/";
	if (!url.startsWith(prefix)) {
		throw new Error(`Map asset URL is outside the static namespace: ${url}`);
	}
	return url.slice(prefix.length);
}

function readJson(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function readFileBytes(filePath: string): Uint8Array {
	return new Uint8Array(readFileSync(filePath));
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(value), null, "\t")}\n`);
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJson);
	}
	if (!isObject(value)) {
		return value;
	}
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortJson(value[key])]),
	);
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readSafeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function visitCoordinates(value: unknown, visit: (coordinate: [number, number]) => void): void {
	if (!Array.isArray(value)) {
		throw new Error("GeoJSON coordinates must be arrays.");
	}
	if (
		value.length >= 2 &&
		typeof value[0] === "number" &&
		Number.isFinite(value[0]) &&
		typeof value[1] === "number" &&
		Number.isFinite(value[1])
	) {
		visit([value[0], value[1]]);
		return;
	}
	for (const child of value) {
		visitCoordinates(child, visit);
	}
}

function isInsideBounds(
	coordinate: readonly [number, number],
	bounds: readonly [number, number, number, number],
): boolean {
	return (
		coordinate[0] >= bounds[0] &&
		coordinate[0] <= bounds[2] &&
		coordinate[1] >= bounds[1] &&
		coordinate[1] <= bounds[3]
	);
}

export async function updateCampusMapSnapshot(
	campus: CampusId,
	input: { dataRoot?: string; fetcher?: typeof fetch } = {},
): Promise<void> {
	const dataRoot = resolve(input.dataRoot ?? DATA_ROOT);
	const query = readFileSync(resolve(dataRoot, "queries", `${campus}.ql`), "utf8");
	const bbox = CAMPUS_CONFIG[campus].bounds;
	const queryBody = query.replace("{{bbox}}", `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`);
	const response = await (input.fetcher ?? fetch)("https://overpass-api.de/api/interpreter", {
		body: new URLSearchParams({ data: queryBody }),
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`Overpass request failed with HTTP ${response.status}.`);
	}
	const snapshot = await response.json();
	validateOsmSnapshot(snapshot, campus);
	writeFileAtomically(
		resolve(dataRoot, "snapshots", `${campus}.overpass.json`),
		canonicalJsonBytes(snapshot),
	);
}

function validateOsmSnapshot(value: unknown, campus: CampusId): asserts value is OsmSnapshot {
	if (!(isObject(value) && Array.isArray(value.elements) && value.elements.length > 0)) {
		throw new Error(`Invalid Overpass snapshot for ${campus}.`);
	}
	const identities = new Set<string>();
	for (const [index, element] of value.elements.entries()) {
		if (
			!isObject(element) ||
			(element.type !== "way" && element.type !== "relation") ||
			!Number.isSafeInteger(element.id) ||
			(element.id as number) <= 0
		) {
			throw new Error(`Invalid Overpass element for ${campus} at index ${index}.`);
		}
		const identity = `${element.type}/${element.id}`;
		if (identities.has(identity)) {
			throw new Error(`Duplicate Overpass element for ${campus}: ${identity}.`);
		}
		identities.add(identity);
	}
}

function writeFileAtomically(filePath: string, bytes: Uint8Array): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const tempDirectory = mkdtempSync(join(dirname(filePath), ".campus-map-file-"));
	const tempPath = join(tempDirectory, basename(filePath));
	try {
		writeFileSync(tempPath, bytes);
		renameSync(tempPath, filePath);
	} finally {
		rmSync(tempDirectory, { force: true, recursive: true });
	}
}

async function main(): Promise<void> {
	const args = parseCampusMapCommandArgs(process.argv.slice(2));
	if (args.mode === "normalize") {
		console.log(JSON.stringify(normalizeCampusMapAssets(), null, "\t"));
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

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
