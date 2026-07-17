export const DINING_WAYFINDING_SCHEMA_VERSION = 2 as const;
export const DINING_WAYFINDING_CANVAS = { height: 760, width: 1280 } as const;
export const DINING_WAYFINDING_MIN_WINDOW = { height: 72, width: 88 } as const;
export const DINING_WAYFINDING_ICON_KEYS = [
	"armchair",
	"coffee",
	"door-open",
	"stairs",
	"utensils",
] as const;

export type DiningWayfindingIconKey = (typeof DINING_WAYFINDING_ICON_KEYS)[number];

export interface DiningWayfindingCanvas {
	height: number;
	width: number;
}

export interface DiningWayfindingRect {
	height: number;
	id: string;
	label: string;
	width: number;
	x: number;
	y: number;
}

export interface DiningWayfindingPoint {
	x: number;
	y: number;
}

export interface DiningWayfindingPolygon {
	id: string;
	points: DiningWayfindingPoint[];
}

export interface DiningWayfindingPolyline {
	id: string;
	points: DiningWayfindingPoint[];
}

export interface DiningWayfindingEntrance extends DiningWayfindingRect {
	side: "bottom" | "left" | "right" | "top";
}

export interface DiningWayfindingLandmark extends DiningWayfindingRect {
	kind: "seating" | "stairs";
}

export interface DiningWayfindingRegion extends DiningWayfindingRect {
	iconKey: DiningWayfindingIconKey | null;
}

export interface DiningWayfindingWindow {
	anchorId: string;
	height: number;
	label: string;
	width: number;
	x: number;
	y: number;
}

export interface DiningWayfindingLayout {
	canvas: DiningWayfindingCanvas;
	entrances: DiningWayfindingEntrance[];
	floorId: string;
	floorplanId: string;
	hallId: string;
	label: string;
	landmarks: DiningWayfindingLandmark[];
	outline: { points: DiningWayfindingPoint[] };
	partitions: DiningWayfindingPolyline[];
	regions: DiningWayfindingRegion[];
	schemaVersion: typeof DINING_WAYFINDING_SCHEMA_VERSION;
	structures: DiningWayfindingPolygon[];
	windows: DiningWayfindingWindow[];
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const WINDOW_IDENTIFIER_PATTERN = /^window-[0-9]{2,}$/;
const ICON_KEYS = new Set<string>(DINING_WAYFINDING_ICON_KEYS);

export function assertDiningWayfindingLayout(
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
	assertWindowClearance(value);
}

export function canonicalizeDiningWayfindingLayout(
	value: DiningWayfindingLayout,
): DiningWayfindingLayout {
	assertDiningWayfindingLayout(value);
	const canonical: DiningWayfindingLayout = {
		canvas: { height: value.canvas.height, width: value.canvas.width },
		entrances: value.entrances.map((entrance) => ({
			height: canonicalizeNumber(entrance.height),
			id: entrance.id.trim(),
			label: entrance.label.trim(),
			side: entrance.side,
			width: canonicalizeNumber(entrance.width),
			x: canonicalizeNumber(entrance.x),
			y: canonicalizeNumber(entrance.y),
		})),
		floorId: value.floorId.trim(),
		floorplanId: value.floorplanId.trim(),
		hallId: value.hallId.trim(),
		label: value.label.trim(),
		landmarks: value.landmarks.map((landmark) => ({
			height: canonicalizeNumber(landmark.height),
			id: landmark.id.trim(),
			kind: landmark.kind,
			label: landmark.label.trim(),
			width: canonicalizeNumber(landmark.width),
			x: canonicalizeNumber(landmark.x),
			y: canonicalizeNumber(landmark.y),
		})),
		outline: { points: canonicalizePoints(value.outline.points) },
		partitions: value.partitions.map((partition) => ({
			id: partition.id.trim(),
			points: canonicalizePoints(partition.points),
		})),
		regions: value.regions.map((region) => ({
			height: canonicalizeNumber(region.height),
			iconKey: region.iconKey,
			id: region.id.trim(),
			label: region.label.trim(),
			width: canonicalizeNumber(region.width),
			x: canonicalizeNumber(region.x),
			y: canonicalizeNumber(region.y),
		})),
		schemaVersion: DINING_WAYFINDING_SCHEMA_VERSION,
		structures: value.structures.map((structure) => ({
			id: structure.id.trim(),
			points: canonicalizePoints(structure.points),
		})),
		windows: value.windows.map((window) => ({
			anchorId: window.anchorId.trim(),
			height: canonicalizeNumber(window.height),
			label: window.label.trim(),
			width: canonicalizeNumber(window.width),
			x: canonicalizeNumber(window.x),
			y: canonicalizeNumber(window.y),
		})),
	};
	assertDiningWayfindingLayout(canonical);
	return canonical;
}

export function serializeDiningWayfindingLayout(value: DiningWayfindingLayout): string {
	return `${JSON.stringify(canonicalizeDiningWayfindingLayout(value), null, "\t")}\n`;
}

export function renderDiningWayfindingSvg(value: DiningWayfindingLayout): string {
	const layout = canonicalizeDiningWayfindingLayout(value);
	const titleId = `${layout.floorId}-title`;
	const descriptionId = `${layout.floorId}-description`;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.canvas.width} ${layout.canvas.height}" role="img" aria-labelledby="${titleId} ${descriptionId}" data-dining-floor-id="${escapeXml(layout.floorId)}">`,
		`<title id="${titleId}">${escapeXml(layout.label)}</title>`,
		`<desc id="${descriptionId}">档口编号、就餐区域和入口位置示意图。</desc>`,
		`<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif;letter-spacing:0}.wayfinding-outline,.wayfinding-structure,.wayfinding-partition,.wayfinding-region,.wayfinding-landmark,.wayfinding-entrance-line,.wayfinding-window,.wayfinding-icon{vector-effect:non-scaling-stroke}.wayfinding-canvas{fill:#f7f9f8}.wayfinding-surface{fill:#ffffff}.wayfinding-outline{fill:none;stroke:#94a3b8;stroke-width:4;stroke-linejoin:round}.wayfinding-structure{fill:#e8edef;stroke:#b8c3ca;stroke-width:2.5;stroke-linejoin:round}.wayfinding-partition{fill:none;stroke:#c3ccd2;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.wayfinding-region{fill:#edf6f1;stroke:#c5ddd2;stroke-width:2}.wayfinding-landmark{fill:#f4f6f5;stroke:#b8c3ca;stroke-width:2}.wayfinding-region-label,.wayfinding-landmark-label{fill:#475569;font-size:18px;font-weight:600}.wayfinding-icon{fill:none;stroke:#16805a;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.wayfinding-entrance-line{stroke:#16805a;stroke-width:6;stroke-linecap:round}.wayfinding-entrance-label{fill:#16805a;font-size:17px;font-weight:700}.wayfinding-window{fill:#ffffff;stroke:#64748b;stroke-width:2.5}.wayfinding-window-number{fill:#263442;font-size:26px;font-weight:750}</style>`,
		`<rect width="${layout.canvas.width}" height="${layout.canvas.height}" class="wayfinding-canvas"/>`,
		`<path d="${pointsToSvgPath(layout.outline.points, true)}" class="wayfinding-surface"/>`,
		...layout.regions.map(renderRegion),
		...layout.structures.map(renderStructure),
		...layout.partitions.map(renderPartition),
		...layout.landmarks.map(renderLandmark),
		...layout.entrances.map(renderEntrance),
		...layout.windows.map(renderWindow),
		`<path data-map-role="outline" d="${pointsToSvgPath(layout.outline.points, true)}" class="wayfinding-outline"/>`,
		"</svg>",
	].join("");
}

function renderStructure(structure: DiningWayfindingPolygon): string {
	return `<path data-map-role="structure" data-layout-structure-id="${escapeXml(structure.id)}" d="${pointsToSvgPath(structure.points, true)}" class="wayfinding-structure"/>`;
}

function renderPartition(partition: DiningWayfindingPolyline): string {
	return `<path data-map-role="partition" data-layout-partition-id="${escapeXml(partition.id)}" d="${pointsToSvgPath(partition.points, false)}" class="wayfinding-partition"/>`;
}

function renderRegion(region: DiningWayfindingRegion): string {
	const centerX = region.x + region.width / 2;
	const centerY = region.y + region.height / 2;
	const icon = region.iconKey
		? renderWayfindingIcon(region.iconKey, centerX - 12, centerY - 31)
		: "";
	const labelY = centerY + (region.iconKey ? 29 : 6);
	return `<g data-map-role="region" data-layout-element-kind="region" data-layout-element-id="${escapeXml(region.id)}"><rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" rx="8" class="wayfinding-region"/>${icon}<text x="${centerX}" y="${labelY}" text-anchor="middle" class="wayfinding-region-label">${escapeXml(region.label)}</text></g>`;
}

function renderLandmark(landmark: DiningWayfindingLandmark): string {
	return `<g data-map-role="landmark" data-layout-element-kind="landmark" data-layout-element-id="${escapeXml(landmark.id)}" data-landmark-kind="${landmark.kind}"><rect x="${landmark.x}" y="${landmark.y}" width="${landmark.width}" height="${landmark.height}" rx="6" class="wayfinding-landmark"/><text x="${landmark.x + landmark.width / 2}" y="${landmark.y + landmark.height / 2 + 6}" text-anchor="middle" class="wayfinding-landmark-label">${escapeXml(landmark.label)}</text></g>`;
}

function renderEntrance(entrance: DiningWayfindingEntrance): string {
	const horizontal = entrance.side === "top" || entrance.side === "bottom";
	const x1 = horizontal ? entrance.x + 8 : entrance.x + entrance.width / 2;
	const x2 = horizontal ? entrance.x + entrance.width - 8 : x1;
	const y1 = horizontal ? entrance.y + entrance.height / 2 : entrance.y + 8;
	const y2 = horizontal ? y1 : entrance.y + entrance.height - 8;
	const label = entranceLabelPosition(entrance);
	return `<g data-map-role="entrance" data-layout-element-kind="entrance" data-layout-element-id="${escapeXml(entrance.id)}"><rect x="${entrance.x}" y="${entrance.y}" width="${entrance.width}" height="${entrance.height}" fill="transparent"/><path d="M${x1} ${y1}L${x2} ${y2}" class="wayfinding-entrance-line"/><text x="${label.x}" y="${label.y}" text-anchor="${label.anchor}" class="wayfinding-entrance-label">${escapeXml(entrance.label)}</text></g>`;
}

function entranceLabelPosition(entrance: DiningWayfindingEntrance): {
	anchor: "end" | "middle" | "start";
	x: number;
	y: number;
} {
	if (entrance.side === "right") {
		return {
			anchor: "start",
			x: entrance.x + entrance.width + 8,
			y: entrance.y + entrance.height / 2 + 6,
		};
	}
	if (entrance.side === "left") {
		return {
			anchor: "end",
			x: entrance.x - 8,
			y: entrance.y + entrance.height / 2 + 6,
		};
	}
	return {
		anchor: "middle",
		x: entrance.x + entrance.width / 2,
		y:
			entrance.side === "top"
				? entrance.y + entrance.height + 18
				: entrance.y + entrance.height + 10,
	};
}

function renderWindow(window: DiningWayfindingWindow): string {
	const number = window.anchorId.slice("window-".length);
	return `<g data-dining-role="window" data-dining-anchor-id="${escapeXml(window.anchorId)}" data-dining-label="${escapeXml(window.label)}" data-layout-element-kind="window" data-layout-element-id="${escapeXml(window.anchorId)}"><rect data-dining-anchor-hit="true" x="${window.x}" y="${window.y}" width="${window.width}" height="${window.height}" rx="6" class="wayfinding-window"/><text data-dining-anchor-number="true" x="${window.x + window.width / 2}" y="${window.y + window.height / 2 + 9}" text-anchor="middle" class="wayfinding-window-number">${escapeXml(number)}</text></g>`;
}

function canonicalizePoints(points: DiningWayfindingPoint[]): DiningWayfindingPoint[] {
	return points.map((point) => ({
		x: canonicalizeNumber(point.x),
		y: canonicalizeNumber(point.y),
	}));
}

function canonicalizeNumber(value: number): number {
	const rounded = Math.round(value * 1_000) / 1_000;
	return Object.is(rounded, -0) ? 0 : rounded;
}

function pointsToSvgPath(points: DiningWayfindingPoint[], closed: boolean): string {
	const [first, ...rest] = points;
	if (!first) {
		throw new Error("Dining wayfinding path requires at least one point.");
	}
	return `M${formatNumber(first.x)} ${formatNumber(first.y)}${rest
		.map((point) => `L${formatNumber(point.x)} ${formatNumber(point.y)}`)
		.join("")}${closed ? "Z" : ""}`;
}

function formatNumber(value: number): string {
	return String(canonicalizeNumber(value));
}

function renderWayfindingIcon(iconKey: DiningWayfindingIconKey, x: number, y: number): string {
	const paths: Record<DiningWayfindingIconKey, string> = {
		armchair:
			'<path d="M5 11V7a3 3 0 0 1 6 0v4M13 11V7a3 3 0 0 1 6 0v4M3 11v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M6 18v3M18 18v3M3 13h18"/>',
		coffee:
			'<path d="M6 2v2M10 2v2M14 2v2M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM16 10h2a3 3 0 0 1 0 6h-3M4 22h14"/>',
		"door-open": '<path d="M13 4.5 6 3v18l7-1.5ZM13 6h5v15h-5M9.5 12h.01"/>',
		stairs: '<path d="M3 19h5v-4h5v-4h5V7h3M3 5h4v4"/>',
		utensils:
			'<path d="M3 2v7c0 1.7 1.3 3 3 3s3-1.3 3-3V2M6 2v20M15 2v20M15 2c3 0 5 2.7 5 6v4h-5"/>',
	};
	return `<g aria-hidden="true" transform="translate(${formatNumber(x)} ${formatNumber(y)})" class="wayfinding-icon">${paths[iconKey]}</g>`;
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

function polygonSignedArea(points: DiningWayfindingPoint[]): number {
	return (
		points.reduce((area, point, index) => {
			const next = points[(index + 1) % points.length];
			return next ? area + point.x * next.y - next.x * point.y : area;
		}, 0) / 2
	);
}

function polygonSelfIntersects(points: DiningWayfindingPoint[]): boolean {
	for (let left = 0; left < points.length; left += 1) {
		const leftEnd = (left + 1) % points.length;
		for (let right = left + 1; right < points.length; right += 1) {
			const rightEnd = (right + 1) % points.length;
			if (left === right || leftEnd === right || rightEnd === left) {
				continue;
			}
			const a = points[left];
			const b = points[leftEnd];
			const c = points[right];
			const d = points[rightEnd];
			if (a && b && c && d && segmentsIntersect(a, b, c, d)) {
				return true;
			}
		}
	}
	return false;
}

function segmentsIntersect(
	a: DiningWayfindingPoint,
	b: DiningWayfindingPoint,
	c: DiningWayfindingPoint,
	d: DiningWayfindingPoint,
): boolean {
	const abC = orientation(a, b, c);
	const abD = orientation(a, b, d);
	const cdA = orientation(c, d, a);
	const cdB = orientation(c, d, b);
	if (abC === 0 && pointOnSegment(a, b, c)) {
		return true;
	}
	if (abD === 0 && pointOnSegment(a, b, d)) {
		return true;
	}
	if (cdA === 0 && pointOnSegment(c, d, a)) {
		return true;
	}
	if (cdB === 0 && pointOnSegment(c, d, b)) {
		return true;
	}
	return abC !== abD && cdA !== cdB;
}

function orientation(
	a: DiningWayfindingPoint,
	b: DiningWayfindingPoint,
	c: DiningWayfindingPoint,
): -1 | 0 | 1 {
	const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	if (Math.abs(cross) < 0.000_001) {
		return 0;
	}
	return cross > 0 ? 1 : -1;
}

function pointOnSegment(
	a: DiningWayfindingPoint,
	b: DiningWayfindingPoint,
	point: DiningWayfindingPoint,
): boolean {
	return (
		point.x >= Math.min(a.x, b.x) &&
		point.x <= Math.max(a.x, b.x) &&
		point.y >= Math.min(a.y, b.y) &&
		point.y <= Math.max(a.y, b.y)
	);
}

function samePoint(left: DiningWayfindingPoint, right: DiningWayfindingPoint): boolean {
	return left.x === right.x && left.y === right.y;
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
		assertRectBounds(item, `windows[${index}]`, canvas);
		if (
			Number(item.width) < DINING_WAYFINDING_MIN_WINDOW.width ||
			Number(item.height) < DINING_WAYFINDING_MIN_WINDOW.height
		) {
			throw new Error(`Dining wayfinding window is smaller than 88x72: ${item.anchorId}`);
		}
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

function assertWindowClearance(value: Record<string, unknown>): void {
	const windows = value.windows as Record<string, unknown>[];
	const blockers = [
		...windows,
		...(value.regions as Record<string, unknown>[]),
		...(value.landmarks as Record<string, unknown>[]),
	];
	for (const window of windows) {
		for (const blocker of blockers) {
			if (window === blocker) {
				continue;
			}
			if (rectanglesOverlap(window, blocker)) {
				throw new Error(
					`Dining wayfinding window overlaps another interactive area: ${String(window.anchorId)}`,
				);
			}
		}
	}
}

function rectanglesOverlap(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
	const leftX = Number(left.x);
	const leftY = Number(left.y);
	const rightX = Number(right.x);
	const rightY = Number(right.y);
	return (
		leftX < rightX + Number(right.width) &&
		leftX + Number(left.width) > rightX &&
		leftY < rightY + Number(right.height) &&
		leftY + Number(left.height) > rightY
	);
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

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
