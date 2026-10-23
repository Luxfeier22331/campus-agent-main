import { XMLBuilder, XMLParser } from "fast-xml-parser";

export type DiningFloorplanAnchorRole = "window" | "region" | "entrance" | "seat" | "service";

export interface DiningFloorplanAnchor {
	anchorId: string;
	label?: string;
	role: DiningFloorplanAnchorRole;
}

export interface DiningRenderedFloorplan {
	anchorInventory: DiningFloorplanAnchor[];
	canvas: { height: number; width: number };
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: `sha256:${string}`;
	svgAssetUrl: string;
	svgMarkup: string;
}

export interface DiningRenderedFloorplanInput {
	anchorInventory?: DiningFloorplanAnchor[];
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: `sha256:${string}`;
	svgMarkup: string;
}

const XML_OPTIONS = {
	attributeNamePrefix: "@_",
	ignoreAttributes: false,
	parseTagValue: false,
	preserveOrder: false,
} as const;

const FORBIDDEN_TAGS = new Set(["foreignObject", "iframe", "script"]);
const ALLOWED_ANCHOR_ROLES = new Set<DiningFloorplanAnchorRole>([
	"window",
	"region",
	"entrance",
	"seat",
	"service",
]);

export function createDiningRenderedFloorplan(
	input: DiningRenderedFloorplanInput,
): DiningRenderedFloorplan {
	const sanitizedSvgMarkup = sanitizeDiningFloorplanSvg(input.svgMarkup);
	const canvas = extractDiningSvgCanvas(sanitizedSvgMarkup, input.floorplanId);
	const extractedAnchors = extractDiningSvgAnchors(sanitizedSvgMarkup);
	const anchorInventory = input.anchorInventory ?? extractedAnchors;
	assertAnchorInventoryMatchesSvg({
		anchorInventory,
		extractedAnchors,
		floorplanId: input.floorplanId,
	});
	assertDiningRenderedFloorplans([{ ...input, anchorInventory, svgMarkup: sanitizedSvgMarkup }]);
	return {
		anchorInventory,
		canvas,
		floorId: input.floorId,
		floorplanId: input.floorplanId,
		hallId: input.hallId,
		sha256: input.sha256,
		svgAssetUrl: buildDiningFloorplanAssetUrl(input.sha256),
		svgMarkup: sanitizedSvgMarkup,
	};
}

export function assertDiningRenderedFloorplans(
	entries: readonly DiningRenderedFloorplanInput[],
): void {
	const seenFloorKeys = new Set<string>();
	const seenFloorplanIds = new Set<string>();

	for (const entry of entries) {
		assertRequiredRenderedFloorplanFields(entry);
		const floorKey = `${entry.hallId}/${entry.floorId}`;
		if (seenFloorKeys.has(floorKey)) {
			throw new Error(`Duplicate dining floorplan floor key: ${floorKey}`);
		}
		seenFloorKeys.add(floorKey);
		if (seenFloorplanIds.has(entry.floorplanId)) {
			throw new Error(`Duplicate dining floorplan id: ${entry.floorplanId}`);
		}
		seenFloorplanIds.add(entry.floorplanId);

		const sanitizedSvgMarkup = sanitizeDiningFloorplanSvg(entry.svgMarkup);
		extractDiningSvgCanvas(sanitizedSvgMarkup, entry.floorplanId);
		const extractedAnchors = extractDiningSvgAnchors(sanitizedSvgMarkup);
		if (extractedAnchors.length === 0) {
			throw new Error(`Dining SVG has no data-dining-anchor-id: ${entry.floorplanId}`);
		}
		assertDiningSvgInteractionContract(sanitizedSvgMarkup, entry.floorplanId);
		if (entry.anchorInventory) {
			assertAnchorInventoryMatchesSvg({
				anchorInventory: entry.anchorInventory,
				extractedAnchors,
				floorplanId: entry.floorplanId,
			});
		}
		buildDiningFloorplanAssetUrl(entry.sha256);
	}
}

export function buildDiningFloorplanAssetUrl(sha256: `sha256:${string}`): string {
	const digest = /^sha256:([0-9a-f]{64})$/.exec(sha256)?.[1];
	if (!digest) {
		throw new Error("Dining floorplan sha256 is invalid.");
	}
	return `/api/dining/floorplans/${digest}.svg`;
}

export function sanitizeDiningFloorplanSvg(svgMarkup: string): string {
	const parser = new XMLParser(XML_OPTIONS);
	let parsed: unknown;
	try {
		parsed = parser.parse(svgMarkup);
	} catch {
		throw new Error("Dining SVG markup is not valid XML.");
	}
	if (!parsed || typeof parsed !== "object" || !("svg" in parsed)) {
		throw new Error("Dining SVG root element is required.");
	}
	assertSafeSvgNode(parsed);
	return buildXml(parsed);
}

function extractDiningSvgCanvas(
	svgMarkup: string,
	floorplanId: string,
): { height: number; width: number } {
	const parser = new XMLParser(XML_OPTIONS);
	const parsed = parser.parse(svgMarkup) as { svg?: Record<string, unknown> };
	const values = readString(parsed.svg?.["@_viewBox"])
		?.split(/[\s,]+/)
		.map(Number);
	const width = values?.[2];
	const height = values?.[3];
	if (
		values?.length !== 4 ||
		!values.every(Number.isFinite) ||
		!width ||
		!height ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(`Dining SVG has an invalid viewBox: ${floorplanId}`);
	}
	return { height, width };
}

function buildXml(parsed: unknown): string {
	const builder = new XMLBuilder({
		...XML_OPTIONS,
		format: false,
		suppressBooleanAttributes: false,
	});
	return builder.build(parsed);
}

function assertSafeSvgNode(value: unknown): void {
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (key.startsWith("@_on") || key === "@_href" || key === "@_xlink:href") {
			throw new Error(`Forbidden dining SVG attribute: ${key}`);
		}
		if (FORBIDDEN_TAGS.has(key)) {
			throw new Error(`Forbidden dining SVG element: ${key}`);
		}
		assertSafeSvgNode(nested);
	}
}

function extractDiningSvgAnchors(svgMarkup: string): DiningFloorplanAnchor[] {
	const parser = new XMLParser(XML_OPTIONS);
	const parsed = parser.parse(svgMarkup);
	const anchors: DiningFloorplanAnchor[] = [];
	const seen = new Set<string>();
	visitSvgNode(parsed, (node) => {
		const anchorId = readString(node["@_data-dining-anchor-id"]);
		if (!anchorId) {
			return;
		}
		if (seen.has(anchorId)) {
			throw new Error(`Duplicate dining SVG anchor: ${anchorId}`);
		}
		seen.add(anchorId);
		const label = readString(node["@_data-dining-label"]);
		anchors.push({
			anchorId,
			...(label === null ? {} : { label }),
			role: normalizeAnchorRole(readString(node["@_data-dining-role"])),
		});
	});
	return anchors;
}

function assertDiningSvgInteractionContract(svgMarkup: string, floorplanId: string): void {
	const parser = new XMLParser(XML_OPTIONS);
	const parsed = parser.parse(svgMarkup);
	visitSvgNode(parsed, (node) => {
		const anchorId = readString(node["@_data-dining-anchor-id"]);
		if (!anchorId) {
			return;
		}
		if (
			countXmlAttribute(node, "@_data-dining-anchor-hit") !== 1 ||
			countXmlAttribute(node, "@_data-dining-anchor-number") !== 1
		) {
			throw new Error(
				`Dining SVG anchor interaction contract is invalid: ${floorplanId}/${anchorId}`,
			);
		}
	});
}

function countXmlAttribute(value: unknown, attribute: string): number {
	if (!value || typeof value !== "object") {
		return 0;
	}
	const record = value as Record<string, unknown>;
	let count = attribute in record ? 1 : 0;
	for (const nested of Object.values(record)) {
		if (Array.isArray(nested)) {
			for (const item of nested) {
				count += countXmlAttribute(item, attribute);
			}
		} else {
			count += countXmlAttribute(nested, attribute);
		}
	}
	return count;
}

function assertAnchorInventoryMatchesSvg(input: {
	anchorInventory: readonly DiningFloorplanAnchor[];
	extractedAnchors: readonly DiningFloorplanAnchor[];
	floorplanId: string;
}): void {
	const inventoryAnchorIds = input.anchorInventory.map((anchor) => anchor.anchorId);
	const extractedAnchorIds = input.extractedAnchors.map((anchor) => anchor.anchorId);
	if (new Set(inventoryAnchorIds).size !== inventoryAnchorIds.length) {
		throw new Error(`Duplicate dining rendered floorplan anchor: ${input.floorplanId}`);
	}
	if (
		inventoryAnchorIds.length !== extractedAnchorIds.length ||
		!inventoryAnchorIds.every((anchorId, index) => anchorId === extractedAnchorIds[index])
	) {
		throw new Error(
			`Dining rendered floorplan anchor inventory does not match extracted anchors: ${input.floorplanId}`,
		);
	}
}

function normalizeAnchorRole(value: string | null): DiningFloorplanAnchorRole {
	if (!value) {
		return "region";
	}
	if (!ALLOWED_ANCHOR_ROLES.has(value as DiningFloorplanAnchorRole)) {
		throw new Error(`Unsupported dining SVG anchor role: ${value}`);
	}
	return value as DiningFloorplanAnchorRole;
}

function assertRequiredRenderedFloorplanFields(input: DiningRenderedFloorplanInput): void {
	for (const field of ["floorId", "floorplanId", "hallId", "svgMarkup"] as const) {
		if (!input[field].trim()) {
			throw new Error(`Dining rendered floorplan field is required: ${field}`);
		}
	}
}

function visitSvgNode(value: unknown, visitor: (node: Record<string, unknown>) => void): void {
	if (!value || typeof value !== "object") {
		return;
	}
	const record = value as Record<string, unknown>;
	visitor(record);
	for (const nested of Object.values(record)) {
		if (Array.isArray(nested)) {
			for (const item of nested) {
				visitSvgNode(item, visitor);
			}
		} else {
			visitSvgNode(nested, visitor);
		}
	}
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
