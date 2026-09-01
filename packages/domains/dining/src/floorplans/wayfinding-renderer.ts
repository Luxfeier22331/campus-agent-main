import { canonicalizeDiningWayfindingLayout, canonicalizeNumber } from "./wayfinding-canonical.ts";
import type {
	DiningWayfindingEntrance,
	DiningWayfindingIconKey,
	DiningWayfindingLandmark,
	DiningWayfindingLayout,
	DiningWayfindingPoint,
	DiningWayfindingPolygon,
	DiningWayfindingPolyline,
	DiningWayfindingRegion,
	DiningWayfindingWindow,
} from "./wayfinding-types.ts";

export function renderDiningWayfindingSvg(value: DiningWayfindingLayout): string {
	const layout = canonicalizeDiningWayfindingLayout(value);
	const titleId = `${layout.floorId}-title`;
	const descriptionId = `${layout.floorId}-description`;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.canvas.width} ${layout.canvas.height}" role="img" aria-labelledby="${titleId} ${descriptionId}" data-dining-floor-id="${escapeXml(layout.floorId)}">`,
		`<title id="${titleId}">${escapeXml(layout.label)}</title>`,
		`<desc id="${descriptionId}">窗口、就餐区域和入口位置示意图。</desc>`,
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
		y: entrance.side === "top" ? entrance.y - 8 : entrance.y + entrance.height + 18,
	};
}

function renderWindow(window: DiningWayfindingWindow): string {
	const number = window.anchorId.slice("window-".length);
	return `<g data-dining-role="window" data-dining-anchor-id="${escapeXml(window.anchorId)}" data-dining-label="${escapeXml(window.label)}" data-layout-element-kind="window" data-layout-element-id="${escapeXml(window.anchorId)}"><rect data-dining-anchor-hit="true" x="${window.x}" y="${window.y}" width="${window.width}" height="${window.height}" rx="6" class="wayfinding-window"/><text data-dining-anchor-number="true" x="${window.x + window.width / 2}" y="${window.y + window.height / 2 + 9}" text-anchor="middle" class="wayfinding-window-number">${escapeXml(number)}</text></g>`;
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

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
