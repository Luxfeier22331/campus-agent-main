export const DINING_WAYFINDING_SCHEMA_VERSION = 2 as const;
export const DINING_WAYFINDING_CANVAS = { height: 760, width: 1280 } as const;
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

export function isDiningWayfindingPlaceholderWindowLabel(value: string): boolean {
	return /^(?:位置\s*\d+|新位置|未命名窗口(?:\s*\d+)?)$/u.test(value.trim());
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

export type DiningWayfindingDiagnosticCode = "invalid_layout" | "window_overlap";

export interface DiningWayfindingDiagnosticEntity {
	id: string;
	kind: "landmark" | "region" | "window";
	label: string;
}

export interface DiningWayfindingDiagnostic {
	code: DiningWayfindingDiagnosticCode;
	entities: DiningWayfindingDiagnosticEntity[];
	message: string;
}

export class DiningWayfindingValidationError extends Error {
	readonly diagnostic: DiningWayfindingDiagnostic;

	constructor(diagnostic: DiningWayfindingDiagnostic) {
		super(diagnostic.message);
		this.name = "DiningWayfindingValidationError";
		this.diagnostic = diagnostic;
	}
}
