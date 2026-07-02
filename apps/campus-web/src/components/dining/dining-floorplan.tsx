import { getDiningFloorplanByFloor } from "dining-floorplans";
import { Maximize2 } from "lucide-react";
import { useEffect } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type { DiningFloorResponse, DiningWindowProjection } from "@/features/dining/model";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function InteractiveFloorplan({
	floor,
	matchedWindowIds,
	onSelectWindow,
	selectedWindowId,
	windows,
}: {
	floor: DiningFloorResponse;
	matchedWindowIds: ReadonlySet<string> | null;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}) {
	const selectedWindow = windows.find((window) => window.windowId === selectedWindowId) ?? null;
	const isPlaceholder = isPlaceholderDiningFloorplan(floor);
	const manifestFloorplan = resolveLocalDiningFloorplan(floor);
	const normalizedFloorplan = markDiningFloorplanAnchors(
		manifestFloorplan.svgMarkup,
		windows,
		selectedWindow?.svgAnchorId ?? null,
		matchedWindowIds,
	);
	const floorplanKey = `${floor.floor.hallId}:${floor.floor.floorId}:${floor.floor.floorplan.floorplanId}:${floor.floor.floorplan.sha256}`;
	return (
		<TransformWrapper
			key={floorplanKey}
			centerOnInit
			limitToBounds={false}
			maxScale={1.32}
			minScale={0.82}
			wheel={{ disabled: true }}
			pinch={{ step: 3 }}
		>
			<DiningFloorplanZoomSurface
				isPlaceholder={isPlaceholder}
				markup={normalizedFloorplan.markup}
				matchedWindowIds={matchedWindowIds}
				onSelectWindow={onSelectWindow}
				selectedZoomTarget={normalizedFloorplan.selectedZoomTarget}
				windows={windows}
			/>
		</TransformWrapper>
	);
}

function DiningFloorplanZoomSurface({
	isPlaceholder,
	matchedWindowIds,
	markup,
	onSelectWindow,
	selectedZoomTarget,
	windows,
}: {
	isPlaceholder: boolean;
	matchedWindowIds: ReadonlySet<string> | null;
	markup: string;
	onSelectWindow(windowId: string): void;
	selectedZoomTarget: string | null;
	windows: DiningWindowProjection[];
}) {
	const { centerView, resetTransform, zoomToElement } = useControls();
	useEffect(() => {
		if (!selectedZoomTarget) {
			return;
		}
		const selector = `[data-dining-zoom-target="${selectedZoomTarget}"]`;
		if (!document.querySelector(selector)) {
			return;
		}
		zoomToElement(selector, 1.08, 160, "easeOut");
	}, [selectedZoomTarget, zoomToElement]);

	return (
		<div className="min-w-0 rounded-xl bg-[var(--dining-svg-canvas-bg)] p-1.5 md:p-2">
			<div
				className={cn(
					"mb-2 flex flex-wrap items-center gap-2",
					isPlaceholder ? "justify-between" : "justify-end",
				)}
			>
				{isPlaceholder ? (
					<Badge className="bg-muted text-muted-foreground" variant="secondary">
						地图待补充
					</Badge>
				) : null}
				<div
					className="flex flex-wrap justify-end gap-2"
					role="toolbar"
					aria-label="平面图视图控制"
				>
					<Button
						aria-label="适配平面图"
						className="text-[var(--sys-text-muted)] hover:text-[var(--sys-text-strong)]"
						onClick={() => {
							resetTransform(0);
							centerView(1, 120);
						}}
						size="icon"
						variant="secondary"
					>
						<Maximize2 aria-hidden="true" className="size-4" />
					</Button>
				</div>
			</div>
			<TransformComponent
				contentClass="!w-full !max-w-full"
				wrapperClass="min-w-0 !w-full !max-w-full overflow-hidden rounded-lg"
			>
				<div
					className="w-full rounded-lg [&_.dining-svg-anchor.is-dimmed]:cursor-default [&_.dining-svg-anchor.is-dimmed]:opacity-35 [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:fill-[var(--sys-brand-interactive-subtle)] [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:stroke-primary [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:stroke-3 [&_.dining-svg-anchor:not(.is-dimmed)]:cursor-pointer [&_.dining-svg-anchor:not(.is-dimmed):focus-visible_:is(rect,path,polygon,circle,ellipse)]:stroke-primary [&_.dining-svg-anchor:not(.is-dimmed):hover_:is(rect,path,polygon,circle,ellipse)]:stroke-primary [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
					data-testid="dining-inline-floorplan"
				>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: event delegation targets annotated SVG anchors with button roles generated below. */}
					<div
						onClick={(event) => {
							const target = event.target;
							if (!(target instanceof Element)) {
								return;
							}
							const anchorElement = target.closest("[data-dining-anchor-id]");
							const anchorId = anchorElement?.getAttribute("data-dining-anchor-id");
							const window = windows.find((item) => item.svgAnchorId === anchorId);
							if (window && isWindowSelectable(window, matchedWindowIds)) {
								onSelectWindow(window.windowId);
							}
						}}
						onKeyDown={(event) => {
							if (event.key !== "Enter" && event.key !== " ") {
								return;
							}
							const target = event.target;
							if (!(target instanceof Element)) {
								return;
							}
							const anchorId = target.getAttribute("data-dining-anchor-id");
							const window = windows.find((item) => item.svgAnchorId === anchorId);
							if (window && isWindowSelectable(window, matchedWindowIds)) {
								event.preventDefault();
								onSelectWindow(window.windowId);
							}
						}}
					>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: app-api returns sanitized published SVG and this component only annotates dining anchors for selection. */}
						<div dangerouslySetInnerHTML={{ __html: markup }} />
					</div>
				</div>
			</TransformComponent>
		</div>
	);
}

function isPlaceholderDiningFloorplan(floor: DiningFloorResponse): boolean {
	return floor.floor.floorplan.floorplanId.startsWith("placeholder:");
}

function resolveLocalDiningFloorplan(floor: DiningFloorResponse): {
	sha256: string;
	svgMarkup: string;
} {
	try {
		const manifestFloorplan = getDiningFloorplanByFloor({
			floorId: floor.floor.floorId,
			hallId: floor.floor.hallId,
		});
		if (
			manifestFloorplan.floorplanId !== floor.floor.floorplan.floorplanId ||
			manifestFloorplan.sha256 !== floor.floor.floorplan.sha256
		) {
			throw new Error(
				`Dining floorplan manifest mismatch: ${floor.floor.hallId}/${floor.floor.floorId}`,
			);
		}
		return manifestFloorplan;
	} catch (error) {
		if (!isPlaceholderDiningFloorplan(floor)) {
			throw error;
		}
		return {
			sha256: floor.floor.floorplan.sha256,
			svgMarkup: buildPlaceholderFloorplanSvg(floor),
		};
	}
}

function markDiningFloorplanAnchors(
	svgMarkup: string,
	windows: DiningWindowProjection[],
	selectedAnchorId: string | null,
	matchedWindowIds: ReadonlySet<string> | null,
): { markup: string; selectedZoomTarget: string | null } {
	const parser = new DOMParser();
	const document = parser.parseFromString(svgMarkup, "image/svg+xml");
	const windowByAnchor = new Map(
		windows.flatMap((window) => (window.svgAnchorId ? [[window.svgAnchorId, window]] : [])),
	);
	let selectedZoomTarget: string | null = null;
	for (const element of document.querySelectorAll("[data-dining-anchor-id]")) {
		const anchorId = element.getAttribute("data-dining-anchor-id");
		const window = anchorId ? windowByAnchor.get(anchorId) : null;
		element.classList.add("dining-svg-anchor");
		if (window && !isWindowSelectable(window, matchedWindowIds)) {
			element.classList.add("is-dimmed");
		}
		if (anchorId) {
			const zoomTarget = toDiningZoomTarget(anchorId);
			element.setAttribute("data-dining-zoom-target", zoomTarget);
			if (anchorId === selectedAnchorId) {
				selectedZoomTarget = zoomTarget;
			}
		}
		if (anchorId === selectedAnchorId) {
			element.classList.add("is-selected");
		}
		if (window && anchorId) {
			const displayLabel = displayLabelForWindow(window);
			element.setAttribute("data-dining-label", displayLabel);
			const labelElement = element.querySelector("text");
			if (labelElement) {
				labelElement.textContent = displayLabel;
			}
			if (isWindowSelectable(window, matchedWindowIds)) {
				element.setAttribute("role", "button");
				element.setAttribute("tabindex", "0");
				element.setAttribute("aria-label", `选择${displayLabel}`);
			}
			element.setAttribute("data-testid", `dining-anchor-${anchorId}`);
		}
	}
	return {
		markup: new XMLSerializer().serializeToString(document.documentElement),
		selectedZoomTarget,
	};
}

function isWindowSelectable(
	window: DiningWindowProjection,
	matchedWindowIds: ReadonlySet<string> | null,
): boolean {
	return matchedWindowIds === null || matchedWindowIds.has(window.windowId);
}

function toDiningZoomTarget(anchorId: string): string {
	const slug = anchorId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "anchor";
	let hash = 0;
	for (const char of anchorId) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	return `dining-anchor-${slug}-${hash.toString(36)}`;
}

function buildPlaceholderFloorplanSvg(floor: DiningFloorResponse): string {
	const canvas = floor.floor.canvas;
	const width = Math.max(canvas.width, 720);
	const maxWindowBottom = floor.windows.reduce(
		(max, window) => Math.max(max, window.geometry.y + window.geometry.height),
		0,
	);
	const height = Math.max(canvas.height, maxWindowBottom + 120, 420);
	const title = escapeSvgText(floor.floor.label);
	const windows = floor.windows
		.map((window, index) => {
			const anchorId = escapeSvgAttribute(window.svgAnchorId ?? window.windowId);
			const label = escapeSvgText(displayLabelForWindow(window));
			const x = Math.max(32, window.geometry.x);
			const y = Math.max(72, window.geometry.y);
			const itemWidth = Math.max(132, window.geometry.width);
			const itemHeight = Math.max(64, window.geometry.height);
			return `<g data-dining-role="window" data-dining-anchor-id="${anchorId}" data-dining-label="${escapeSvgAttribute(label)}"><rect x="${x}" y="${y}" width="${itemWidth}" height="${itemHeight}" rx="8" fill="#fbfbf8" stroke="#b8c3d1"/><text x="${x + itemWidth / 2}" y="${y + itemHeight / 2 + 5}" text-anchor="middle" font-size="14" fill="#334155">${label || `窗口 ${index + 1}`}</text></g>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvgAttribute(title)}" data-dining-floor-id="${escapeSvgAttribute(floor.floor.floorId)}"><rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="20" fill="#f6f8f7" stroke="#d7dee8"/><text x="56" y="54" font-size="18" fill="#334155">${title}</text>${windows}</svg>`;
}

function escapeSvgText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeSvgAttribute(value: string): string {
	return escapeSvgText(value).replace(/"/g, "&quot;");
}

function displayLabelForWindow(window: DiningWindowProjection): string {
	return window.assignment?.stallProfile.displayName ?? window.label;
}
