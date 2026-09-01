import {
	collectWindowClearanceDiagnostics,
	polygonSelfIntersects,
	polygonSignedArea,
	samePoint,
} from "./wayfinding-geometry.ts";
import type {
	DiningWayfindingCanvas,
	DiningWayfindingDiagnostic,
	DiningWayfindingLayout,
	DiningWayfindingPoint,
} from "./wayfinding-types.ts";
import {
	DINING_WAYFINDING_CANVAS,
	DINING_WAYFINDING_ICON_KEYS,
	DINING_WAYFINDING_SCHEMA_VERSION,
	DiningWayfindingValidationError,
	isDiningWayfindingPlaceholderWindowLabel,
} from "./wayfinding-types.ts";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const WINDOW_IDENTIFIER_PATTERN = /^window-[0-9]{2,}$/;
const ICON_KEYS = new Set<string>(DINING_WAYFINDING_ICON_KEYS);

export function assertDiningWayfindingLayout(
	value: unknown,
): asserts value is DiningWayfindingLayout {
	assertDiningWayfindingLayoutStructure(value);
}

export function assertDiningWayfindingPublishableLayout(
	value: unknown,
): asserts value is DiningWayfindingLayout {
	assertDiningWayfindingLayoutStructure(value);
	const collision = collectWindowClearanceDiagnostics(value)[0];
	if (collision) {
		throw new DiningWayfindingValidationError(collision);
	}
}

export function diagnoseDiningWayfindingLayout(value: unknown): DiningWayfindingDiagnostic[] {
	try {
		assertDiningWayfindingLayoutStructure(value);
	} catch (error) {
		return [
			{
				code: "invalid_layout",
				entities: [],
				message: error instanceof Error ? error.message : "食堂地图格式无效",
			},
		];
	}
	return collectWindowClearanceDiagnostics(value);
}

function assertDiningWayfindingLayoutStructure(
	value: unknown,
): asserts value is DiningWayfindingLayout {
	if (!isRecord(value)) {
		throw new Error("Dining wayfinding layout must be an object.");
	}
	if (value.schemaVersion !== DINING_WAYFINDING_SCHEMA_VERSION) {
		throw new Error("Dining wayfinding layout schemaVersion is unsupported.");
	}
	assertIdentifier(value.hallId, "hallId");
	assertIdentifier(value.floorId, "floorId");
	assertString(value.floorplanId, "floorplanId");
	assertString(value.label, "label");
	if (!isRecord(value.canvas)) {
		throw new Error("Dining wayfinding layout canvas is required.");
	}
	assertFiniteNumber(value.canvas.width, "canvas.width");
	assertFiniteNumber(value.canvas.height, "canvas.height");
	const canvas: DiningWayfindingCanvas = {
		height: value.canvas.height,
		width: value.canvas.width,
	};
	if (
		canvas.width !== DINING_WAYFINDING_CANVAS.width ||
		canvas.height !== DINING_WAYFINDING_CANVAS.height
	) {
		throw new Error("Dining wayfinding layouts must use the shared 1280x760 canvas.");
	}
	if (!isRecord(value.outline)) {
		throw new Error("Dining wayfinding layout outline is required.");
	}
	assertPolygonPoints(value.outline.points, "outline.points", canvas);

	assertPolygonCollection(value.structures, "structure", canvas);
	assertPolylineCollection(value.partitions, "partition", canvas);
	assertRegionCollection(value.regions, canvas);
	assertEntranceCollection(value.entrances, canvas);
	assertLandmarkCollection(value.landmarks, canvas);
	assertWindowCollection(value.windows, canvas);
	assertGloballyUniqueEntityIds(value);
}

function assertPolygonCollection(
	value: unknown,
	name: string,
	canvas: DiningWayfindingCanvas,
): void {
	if (!Array.isArray(value)) {
		throw new Error(`Dining wayfinding ${name}s must be an array.`);
	}
	assertUniqueIds(value, name);
	for (const [index, item] of value.entries()) {
		if (!isRecord(item)) {
			throw new Error(`Dining wayfinding ${name}s[${index}] must be an object.`);
		}
		assertPolygonPoints(item.points, `${name}s[${index}].points`, canvas);
	}
}

function assertPolylineCollection(
	value: unknown,
	name: string,
	canvas: DiningWayfindingCanvas,
): void {
	if (!Array.isArray(value)) {
		throw new Error(`Dining wayfinding ${name}s must be an array.`);
	}
	assertUniqueIds(value, name);
	for (const [index, item] of value.entries()) {
		if (!isRecord(item)) {
			throw new Error(`Dining wayfinding ${name}s[${index}] must be an object.`);
		}
		assertPointCollection(item.points, `${name}s[${index}].points`, canvas, 2);
	}
}

function assertRegionCollection(value: unknown, canvas: DiningWayfindingCanvas): void {
	assertRectCollection(value, "region", canvas);
	for (const [index, item] of (value as unknown[]).entries()) {
		if (!isRecord(item)) {
			throw new Error(`Dining wayfinding regions[${index}] must be an object.`);
		}
		if (item.iconKey !== null && !ICON_KEYS.has(String(item.iconKey))) {
			throw new Error(`Dining wayfinding regions[${index}].iconKey is invalid.`);
		}
	}
}

function assertPolygonPoints(value: unknown, field: string, canvas: DiningWayfindingCanvas): void {
	const points = assertPointCollection(value, field, canvas, 3);
	if (polygonSelfIntersects(points)) {
		throw new Error(`Dining wayfinding ${field} must not self-intersect.`);
	}
	if (Math.abs(polygonSignedArea(points)) < 0.001) {
		throw new Error(`Dining wayfinding ${field} must have a non-zero area.`);
	}
}

function assertPointCollection(
	value: unknown,
	field: string,
	canvas: DiningWayfindingCanvas,
	minimumLength: number,
): DiningWayfindingPoint[] {
	if (!Array.isArray(value) || value.length < minimumLength) {
		throw new Error(`Dining wayfinding ${field} must contain at least ${minimumLength} points.`);
	}
	const points = value.map((point, index) => {
		if (!isRecord(point)) {
			throw new Error(`Dining wayfinding ${field}[${index}] must be an object.`);
		}
		assertFiniteNumber(point.x, `${field}[${index}].x`);
		assertFiniteNumber(point.y, `${field}[${index}].y`);
		if (point.x < 0 || point.y < 0 || point.x > canvas.width || point.y > canvas.height) {
			throw new Error(`Dining wayfinding ${field}[${index}] is outside the canvas.`);
		}
		return { x: point.x, y: point.y };
	});
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		if (current && next && samePoint(current, next)) {
			throw new Error(`Dining wayfinding ${field} contains consecutive duplicate points.`);
		}
	}
	return points;
}

function assertRectCollection(value: unknown, name: string, canvas: DiningWayfindingCanvas): void {
	if (!Array.isArray(value)) {
		throw new Error(`Dining wayfinding ${name}s must be an array.`);
	}
	assertUniqueIds(value, name);
	for (const [index, item] of value.entries()) {
		assertRect(item, `${name}s[${index}]`, canvas);
	}
}

function assertEntranceCollection(value: unknown, canvas: DiningWayfindingCanvas): void {
	assertRectCollection(value, "entrance", canvas);
	for (const [index, item] of (value as unknown[]).entries()) {
		if (!(isRecord(item) && ["bottom", "left", "right", "top"].includes(String(item.side)))) {
			throw new Error(`Dining wayfinding entrances[${index}].side is invalid.`);
		}
	}
}

function assertLandmarkCollection(value: unknown, canvas: DiningWayfindingCanvas): void {
	assertRectCollection(value, "landmark", canvas);
	for (const [index, item] of (value as unknown[]).entries()) {
		if (!(isRecord(item) && ["seating", "stairs"].includes(String(item.kind)))) {
			throw new Error(`Dining wayfinding landmarks[${index}].kind is invalid.`);
		}
	}
}

function assertWindowCollection(value: unknown, canvas: DiningWayfindingCanvas): void {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("Dining wayfinding windows must be a non-empty array.");
	}
	const seen = new Set<string>();
	let previousAnchorId = "";
	for (const [index, item] of value.entries()) {
		if (!isRecord(item)) {
			throw new Error(`Dining wayfinding windows[${index}] must be an object.`);
		}
		assertString(item.anchorId, `windows[${index}].anchorId`);
		if (!WINDOW_IDENTIFIER_PATTERN.test(item.anchorId)) {
			throw new Error(`Dining wayfinding windows[${index}].anchorId is invalid.`);
		}
		if (seen.has(item.anchorId)) {
			throw new Error(`Duplicate dining wayfinding window: ${item.anchorId}`);
		}
		if (previousAnchorId && item.anchorId.localeCompare(previousAnchorId) <= 0) {
			throw new Error("Dining wayfinding windows must be ordered by anchorId.");
		}
		seen.add(item.anchorId);
		previousAnchorId = item.anchorId;
		assertString(item.label, `windows[${index}].label`);
		if (isDiningWayfindingPlaceholderWindowLabel(item.label)) {
			throw new Error(`Dining wayfinding windows[${index}].label must be a public name.`);
		}
		assertRectBounds(item, `windows[${index}]`, canvas);
	}
}

function assertGloballyUniqueEntityIds(value: Record<string, unknown>): void {
	const ids = ["outline"];
	for (const collectionName of [
		"entrances",
		"landmarks",
		"partitions",
		"regions",
		"structures",
	] as const) {
		for (const item of value[collectionName] as Record<string, unknown>[]) {
			ids.push(String(item.id));
		}
	}
	for (const item of value.windows as Record<string, unknown>[]) {
		ids.push(String(item.anchorId));
	}
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			throw new Error(`Duplicate dining wayfinding entity id: ${id}`);
		}
		seen.add(id);
	}
}

function assertUniqueIds(value: unknown[], name: string): void {
	const seen = new Set<string>();
	for (const [index, item] of value.entries()) {
		if (!isRecord(item)) {
			throw new Error(`Dining wayfinding ${name}s[${index}] must be an object.`);
		}
		assertIdentifier(item.id, `${name}s[${index}].id`);
		if (seen.has(item.id)) {
			throw new Error(`Duplicate dining wayfinding ${name}: ${item.id}`);
		}
		seen.add(item.id);
	}
}

function assertRect(value: unknown, field: string, canvas: DiningWayfindingCanvas): void {
	if (!isRecord(value)) {
		throw new Error(`Dining wayfinding ${field} must be an object.`);
	}
	assertString(value.label, `${field}.label`);
	assertRectBounds(value, field, canvas);
}

function assertRectBounds(
	value: Record<string, unknown>,
	field: string,
	canvas: DiningWayfindingCanvas,
): void {
	for (const key of ["height", "width", "x", "y"] as const) {
		assertFiniteNumber(value[key], `${field}.${key}`);
	}
	const height = Number(value.height);
	const width = Number(value.width);
	const x = Number(value.x);
	const y = Number(value.y);
	if (
		height <= 0 ||
		width <= 0 ||
		x < 0 ||
		y < 0 ||
		x + width > canvas.width ||
		y + height > canvas.height
	) {
		throw new Error(`Dining wayfinding ${field} is outside the canvas.`);
	}
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
	assertString(value, field);
	if (!IDENTIFIER_PATTERN.test(value)) {
		throw new Error(`Dining wayfinding ${field} is invalid.`);
	}
}

function assertString(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Dining wayfinding ${field} is required.`);
	}
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Dining wayfinding ${field} must be a finite number.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
