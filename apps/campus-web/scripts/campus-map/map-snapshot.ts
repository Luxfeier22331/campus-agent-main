import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJsonBytes, isObject } from "./map-format";
import { CAMPUS_CONFIG, type CampusId, DATA_ROOT, type OsmSnapshot } from "./map-model";

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
