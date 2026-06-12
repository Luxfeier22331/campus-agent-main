import { XMLBuilder, XMLParser } from "fast-xml-parser";

import { AppApiRouteError } from "../../http";
import { sha256Hex, sha256Tag } from "./hash";
import type { DiningFloorplanAsset, DiningSvgAnchor } from "./release-types";
import type { DiningOperationsState, DiningOpsActor } from "./types";

const XML_OPTIONS = {
	attributeNamePrefix: "@_",
	ignoreAttributes: false,
	preserveOrder: false,
} as const;

const FORBIDDEN_TAGS = new Set(["foreignObject", "iframe", "script"]);

export function createFloorplanAsset(input: {
	actor: DiningOpsActor;
	bucket: string;
	byteSize: number;
	contentType: string;
	floorId: string;
	objectKey: string;
	sourceFilename: string;
	state: DiningOperationsState;
	svgMarkup: string;
}): DiningFloorplanAsset {
	const floorRef = findFloorRef(input.state, input.floorId);
	const sanitizedSvgMarkup = sanitizeSvgMarkup(input.svgMarkup);
	const anchorInventory = extractSvgAnchors(sanitizedSvgMarkup);
	if (anchorInventory.length === 0) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "svgMarkup" },
			message: "SVG must include at least one data-dining-anchor-id.",
			retryable: false,
			status: 400,
		});
	}
	const digest = sha256Hex(sanitizedSvgMarkup);
	const now = new Date().toISOString();
	return {
		anchorInventory,
		createdAt: now,
		createdBy: input.actor.principalId,
		bucket: input.bucket,
		byteSize: input.byteSize,
		contentType: input.contentType,
		floorId: floorRef.floorId,
		floorplanAssetId: `dining_floorplan_asset:${digest.slice(0, 20)}`,
		hallId: floorRef.hallId,
		objectKey: input.objectKey,
		sanitizedSvgMarkup,
		sha256: `sha256:${digest}`,
		sourceFilename: input.sourceFilename,
		status: "draft_ready",
	};
}

export function createSeedFloorplanAsset(input: {
	actorId: string;
	bucket?: string;
	floorId: string;
	hallId: string;
	label: string;
	svgAssetUrl: string;
	windowAnchors: Array<{ label: string; svgAnchorId: string }>;
}): DiningFloorplanAsset {
	const sanitizedSvgMarkup = buildSeedSvgMarkup(input);
	const digest = sha256Hex(sanitizedSvgMarkup);
	return {
		anchorInventory: input.windowAnchors.map((window) => ({
			anchorId: window.svgAnchorId,
			role: "window",
		})),
		bucket: input.bucket ?? "campus-rag-derived",
		byteSize: new TextEncoder().encode(sanitizedSvgMarkup).byteLength,
		contentType: "image/svg+xml",
		createdAt: "2026-06-08T00:00:00.000Z",
		createdBy: input.actorId,
		floorId: input.floorId,
		floorplanAssetId: `dining_floorplan_asset:${input.hallId}:${input.floorId}:initial`,
		hallId: input.hallId,
		objectKey: buildDraftFloorplanObjectKey({
			digest,
			floorId: input.floorId,
			hallId: input.hallId,
		}),
		sanitizedSvgMarkup,
		sha256: `sha256:${digest}`,
		sourceFilename: input.svgAssetUrl.split("/").at(-1) ?? `${input.floorId}.svg`,
		status: "release_ready",
	};
}

export function sanitizeFloorplanSvgForStorage(svgMarkup: string): {
	anchorInventory: DiningSvgAnchor[];
	digest: string;
	sanitizedSvgMarkup: string;
	sha256: string;
} {
	const sanitizedSvgMarkup = sanitizeSvgMarkup(svgMarkup);
	const anchorInventory = extractSvgAnchors(sanitizedSvgMarkup);
	if (anchorInventory.length === 0) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "svgMarkup" },
			message: "SVG must include at least one data-dining-anchor-id.",
			retryable: false,
			status: 400,
		});
	}
	const digest = sha256Hex(sanitizedSvgMarkup);
	return {
		anchorInventory,
		digest,
		sanitizedSvgMarkup,
		sha256: `sha256:${digest}`,
	};
}

export function buildDraftFloorplanObjectKey(input: {
	digest: string;
	floorId: string;
	hallId: string;
}): string {
	return `dining/floorplans/assets/${encodeObjectPathSegment(input.hallId)}/${encodeObjectPathSegment(
		input.floorId,
	)}/sha256-${input.digest}.svg`;
}

export function buildReleaseFloorplanObjectKey(input: {
	digest: string;
	floorId: string;
	hallId: string;
	releaseId: string;
}): string {
	return `dining/releases/${input.releaseId}/floorplans/${encodeObjectPathSegment(
		input.hallId,
	)}/${encodeObjectPathSegment(input.floorId)}/sha256-${input.digest}.svg`;
}

export function buildReleaseSnapshotObjectKey(releaseId: string): string {
	return `dining/releases/${releaseId}/snapshot.json`;
}

export function buildReleaseValidationReportObjectKey(releaseId: string): string {
	return `dining/releases/${releaseId}/validation-report.json`;
}

export function verifyFloorplanAssetChecksum(asset: DiningFloorplanAsset): boolean {
	return asset.sha256 === sha256Tag(asset.sanitizedSvgMarkup);
}

function sanitizeSvgMarkup(svgMarkup: string): string {
	const parser = new XMLParser(XML_OPTIONS);
	let parsed: unknown;
	try {
		parsed = parser.parse(svgMarkup);
	} catch {
		throw invalidSvg("SVG markup is not valid XML.");
	}
	if (!parsed || typeof parsed !== "object" || !("svg" in parsed)) {
		throw invalidSvg("SVG root element is required.");
	}
	assertSafeSvgNode(parsed);
	const builder = new XMLBuilder({
		...XML_OPTIONS,
		format: false,
		suppressBooleanAttributes: false,
	});
	return builder.build(parsed);
}

function extractSvgAnchors(svgMarkup: string): DiningSvgAnchor[] {
	const anchors: DiningSvgAnchor[] = [];
	const parser = new XMLParser(XML_OPTIONS);
	const parsed = parser.parse(svgMarkup);
	visitSvgNode(parsed, (node) => {
		const anchorId = readString(node["@_data-dining-anchor-id"]);
		if (!anchorId) {
			return;
		}
		anchors.push({
			anchorId,
			role: readString(node["@_data-dining-role"]) || "region",
		});
	});
	return anchors;
}

function assertSafeSvgNode(value: unknown): void {
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (key.startsWith("@_on") || key === "@_href" || key === "@_xlink:href") {
			throw invalidSvg(`Forbidden SVG attribute ${key}.`);
		}
		if (FORBIDDEN_TAGS.has(key)) {
			throw invalidSvg(`Forbidden SVG element ${key}.`);
		}
		assertSafeSvgNode(nested);
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

function findFloorRef(state: DiningOperationsState, floorId: string) {
	for (const hall of state.halls) {
		const floor = hall.floors.find((item) => item.floorId === floorId);
		if (floor) {
			return { floorId: floor.floorId, hallId: hall.hallId };
		}
	}
	throw new AppApiRouteError({
		code: "dining_floor_not_found",
		message: "Dining floor projection was not found.",
		retryable: false,
		status: 404,
	});
}

function buildSeedSvgMarkup(input: {
	floorId: string;
	label: string;
	windowAnchors: Array<{ label: string; svgAnchorId: string }>;
}) {
	const windows = input.windowAnchors
		.map((window, index) => {
			const column = index % 3;
			const row = Math.floor(index / 3);
			const x = 64 + column * 180;
			const y = 72 + row * 112;
			return `<g data-dining-role="window" data-dining-anchor-id="${escapeXml(
				window.svgAnchorId,
			)}"><rect x="${x}" y="${y}" width="150" height="72" rx="8" fill="#fff" stroke="#b8c3d1"/><text x="${
				x + 75
			}" y="${y + 42}" text-anchor="middle" font-size="15" font-weight="600" fill="#334155">${escapeXml(
				window.label,
			)}</text></g>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-label="${escapeXml(
		input.label,
	)}" data-dining-floor-id="${escapeXml(input.floorId)}">${windows}</svg>`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function encodeObjectPathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._:-]+/g, "-");
}

function invalidSvg(message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		details: { field: "svgMarkup" },
		message,
		retryable: false,
		status: 400,
	});
}
