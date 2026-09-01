import { canonicalizeDiningWayfindingLayout } from "./wayfinding-canonical.ts";
import type { DiningWayfindingLayout } from "./wayfinding-types.ts";

export const DINING_FLOORPLAN_BUNDLE_KIND = "dining_floorplan_bundle" as const;
export const DINING_FLOORPLAN_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface DiningHallDefinition {
	campus: string;
	hallId: string;
	name: string;
}

export interface DiningFloorplanBundleV1 {
	halls: DiningHallDefinition[];
	kind: typeof DINING_FLOORPLAN_BUNDLE_KIND;
	layouts: DiningWayfindingLayout[];
	schemaVersion: typeof DINING_FLOORPLAN_BUNDLE_SCHEMA_VERSION;
}

export function assertDiningFloorplanBundle(
	value: unknown,
): asserts value is DiningFloorplanBundleV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Dining floorplan bundle must be an object.");
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.join(",") !== "halls,kind,layouts,schemaVersion") {
		throw new Error("Dining floorplan bundle contains unsupported fields.");
	}
	if (record.kind !== DINING_FLOORPLAN_BUNDLE_KIND) {
		throw new Error("Dining floorplan bundle kind is unsupported.");
	}
	if (record.schemaVersion !== DINING_FLOORPLAN_BUNDLE_SCHEMA_VERSION) {
		throw new Error("Dining floorplan bundle schemaVersion is unsupported.");
	}
	if (!Array.isArray(record.layouts) || record.layouts.length === 0) {
		throw new Error("Dining floorplan bundle must contain at least one layout.");
	}
	if (record.layouts.length > 200) {
		throw new Error("Dining floorplan bundle contains too many layouts.");
	}
	for (const layout of record.layouts) {
		canonicalizeDiningWayfindingLayout(layout as DiningWayfindingLayout);
	}
	if (!Array.isArray(record.halls) || record.halls.length === 0) {
		throw new Error("Dining floorplan bundle must contain at least one hall.");
	}
	for (const hall of record.halls) {
		assertHall(hall);
	}
}

export function canonicalizeDiningFloorplanBundle(value: unknown): DiningFloorplanBundleV1 {
	assertDiningFloorplanBundle(value);
	const halls = value.halls.map((hall) => ({
		campus: hall.campus.trim(),
		hallId: hall.hallId.trim(),
		name: hall.name.trim(),
	}));
	const layouts = value.layouts
		.map((layout) => {
			const canonical = canonicalizeDiningWayfindingLayout(layout);
			assertNoUnsupportedFields(layout, canonical, "layout");
			return canonical;
		})
		.sort((left, right) => left.floorplanId.localeCompare(right.floorplanId));
	const floorplanIds = new Set<string>();
	const floorIds = new Set<string>();
	const hallIds = new Set<string>();
	for (const hall of halls) {
		if (hallIds.has(hall.hallId)) {
			throw new Error(`Duplicate dining hall id: ${hall.hallId}`);
		}
		hallIds.add(hall.hallId);
	}
	for (const layout of layouts) {
		if (floorplanIds.has(layout.floorplanId)) {
			throw new Error(`Duplicate dining floorplan id: ${layout.floorplanId}`);
		}
		if (floorIds.has(layout.floorId)) {
			throw new Error(`Duplicate dining floor id: ${layout.floorId}`);
		}
		floorplanIds.add(layout.floorplanId);
		floorIds.add(layout.floorId);
		if (!hallIds.has(layout.hallId)) {
			throw new Error(`Dining floorplan references an unknown hall: ${layout.hallId}`);
		}
	}
	for (const hall of halls) {
		if (!layouts.some((layout) => layout.hallId === hall.hallId)) {
			throw new Error(`Dining hall has no floorplan: ${hall.hallId}`);
		}
	}
	return {
		halls,
		kind: DINING_FLOORPLAN_BUNDLE_KIND,
		layouts,
		schemaVersion: DINING_FLOORPLAN_BUNDLE_SCHEMA_VERSION,
	};
}

export function createDiningFloorplanBundle(
	layouts: DiningWayfindingLayout[],
	halls: DiningHallDefinition[],
): DiningFloorplanBundleV1 {
	return canonicalizeDiningFloorplanBundle({
		halls,
		kind: DINING_FLOORPLAN_BUNDLE_KIND,
		layouts,
		schemaVersion: DINING_FLOORPLAN_BUNDLE_SCHEMA_VERSION,
	});
}

function assertHall(value: unknown): asserts value is DiningHallDefinition {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Dining hall must be an object.");
	}
	const hall = value as Record<string, unknown>;
	if (
		Object.keys(hall).sort().join(",") !== "campus,hallId,name" ||
		![hall.campus, hall.hallId, hall.name].every(
			(item) => typeof item === "string" && item.trim().length > 0,
		)
	) {
		throw new Error("Dining hall is invalid.");
	}
}

export function serializeDiningFloorplanBundle(value: unknown): string {
	return `${JSON.stringify(canonicalizeDiningFloorplanBundle(value), null, "\t")}\n`;
}

function assertNoUnsupportedFields(value: unknown, canonical: unknown, path: string): void {
	if (Array.isArray(canonical)) {
		if (!Array.isArray(value)) {
			return;
		}
		for (const [index, item] of canonical.entries()) {
			assertNoUnsupportedFields(value[index], item, `${path}[${index}]`);
		}
		return;
	}
	if (!(canonical && typeof canonical === "object")) {
		return;
	}
	if (!(value && typeof value === "object") || Array.isArray(value)) {
		return;
	}
	const canonicalRecord = canonical as Record<string, unknown>;
	for (const key of Object.keys(value)) {
		if (!(key in canonicalRecord)) {
			throw new Error(`Dining floorplan bundle contains unsupported field: ${path}.${key}`);
		}
	}
	for (const [key, item] of Object.entries(canonicalRecord)) {
		assertNoUnsupportedFields((value as Record<string, unknown>)[key], item, `${path}.${key}`);
	}
}
