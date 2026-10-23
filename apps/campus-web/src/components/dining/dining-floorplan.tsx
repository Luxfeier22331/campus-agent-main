import { Button } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import {
	lazy,
	memo,
	type ReactNode,
	Suspense,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import type { DiningFloorResponse, DiningWindowProjection } from "@/features/dining/model";
import { diningFloorplanAssetQueryOptions } from "@/features/dining/queries";

import type { DiningMapViewport } from "./dining-map-interaction";
import { DiningWindowList } from "./dining-window-list";

interface InteractiveFloorplanProps {
	initialViewport?: DiningMapViewport | undefined;
	onViewportChange?: ((viewport: DiningMapViewport) => void) | undefined;
	onReady?: (() => void) | undefined;
	floor: DiningFloorResponse;
	/** 浮在地图左上角；平面图不可用时放回降级列表顶部。 */
	floorSwitcher?: ReactNode;
	matchedWindowIds: ReadonlySet<string> | null;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}

const DiningFloorplanZoom = lazy(() =>
	import("./dining-floorplan-zoom").then((module) => ({ default: module.DiningFloorplanZoom })),
);

export function InteractiveFloorplan(props: InteractiveFloorplanProps) {
	const floorplan = props.floor.floor.floorplan;
	const aspectRatio = `${floorplan.canvas.width} / ${floorplan.canvas.height}`;
	const stageHeight = diningMapStageHeight(floorplan.canvas);
	const query = useQuery(
		diningFloorplanAssetQueryOptions({
			svgAssetUrl: floorplan.svgAssetUrl,
		}),
	);
	if (query.isPending) {
		return (
			<div className="@container relative">
				<DiningFloorplanLoading stageHeight={stageHeight} />
				<FloatingFloorSwitcher>{props.floorSwitcher}</FloatingFloorSwitcher>
			</div>
		);
	}
	if (query.isError) {
		return (
			<DiningFloorplanUnavailable
				onReady={props.onReady}
				aspectRatio={aspectRatio}
				floorSwitcher={props.floorSwitcher}
				matchedWindowIds={props.matchedWindowIds}
				onRetry={() => void query.refetch()}
				onSelectWindow={props.onSelectWindow}
				selectedWindowId={props.selectedWindowId}
				windows={props.windows}
			/>
		);
	}
	return <ResolvedInteractiveFloorplan {...props} rawMarkup={query.data} />;
}

/** 画布按宽度等比缩放，上下各留 4rem 给浮动的楼层与缩放控件。 */
function diningMapStageHeight(canvas: { height: number; width: number }): string {
	return `calc(100cqw * ${canvas.height / canvas.width} + 8rem)`;
}

function FloatingFloorSwitcher({ children }: { children: ReactNode }) {
	return children ? (
		<div className="absolute top-2 left-3 z-[1] max-w-[calc(100%-1.5rem)]">{children}</div>
	) : null;
}

function DiningFloorplanLoading({ stageHeight }: { stageHeight: string }) {
	return (
		<div
			aria-busy="true"
			aria-label="正在读取平面图"
			className="grid min-h-56 place-content-center gap-2 bg-[var(--dining-svg-canvas-bg)] px-5 text-center text-sm text-[var(--sys-text-muted)]"
			role="status"
			style={{ height: stageHeight }}
		>
			<LoaderCircle
				aria-hidden="true"
				className="mx-auto size-5 animate-spin motion-reduce:animate-none"
			/>
			<span>正在读取平面图</span>
		</div>
	);
}

function DiningFloorplanUnavailable(props: {
	onReady?: (() => void) | undefined;
	aspectRatio: string;
	floorSwitcher?: ReactNode;
	matchedWindowIds: ReadonlySet<string> | null;
	onRetry?: () => void;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}) {
	useEffect(() => props.onReady?.(), [props.onReady]);
	return (
		<section
			aria-label="平面图降级窗口列表"
			className="min-h-56 w-full min-w-0 max-w-full bg-destructive/5 px-4 py-5 sm:px-5"
		>
			{props.floorSwitcher ? <div className="mb-4">{props.floorSwitcher}</div> : null}
			<div className="text-center" role="alert">
				<h3 className="text-sm font-semibold text-[var(--sys-text-strong)]">平面图暂时无法显示</h3>
				<p className="mt-1 text-sm text-[var(--sys-text-muted)]">仍可从列表选择窗口。</p>
				{props.onRetry ? (
					<Button
						className="mx-auto mt-3 min-h-11"
						onClick={props.onRetry}
						size="sm"
						variant="outline"
					>
						重试
					</Button>
				) : null}
			</div>
			<DiningWindowList
				className="mx-auto mt-4 w-full max-w-xl border-border/70 border-t pt-3"
				matchedWindowIds={props.matchedWindowIds}
				onSelectWindow={props.onSelectWindow}
				selectedWindowId={props.selectedWindowId}
				title="窗口列表"
				windows={props.windows}
			/>
		</section>
	);
}

function ResolvedInteractiveFloorplan({
	initialViewport,
	onViewportChange,
	onReady,
	floor,
	floorSwitcher,
	matchedWindowIds,
	onSelectWindow,
	rawMarkup,
	selectedWindowId,
	windows,
}: InteractiveFloorplanProps & { rawMarkup: string }) {
	const prepared = useMemo(
		() => prepareDiningFloorplanMarkup({ floor, rawMarkup, windows }),
		[floor, rawMarkup, windows],
	);
	if (!prepared) {
		return (
			<DiningFloorplanUnavailable
				onReady={onReady}
				aspectRatio={`${floor.floor.floorplan.canvas.width} / ${floor.floor.floorplan.canvas.height}`}
				floorSwitcher={floorSwitcher}
				matchedWindowIds={matchedWindowIds}
				onSelectWindow={onSelectWindow}
				selectedWindowId={selectedWindowId}
				windows={windows}
			/>
		);
	}
	const selectedWindow = windows.find((window) => window.windowId === selectedWindowId) ?? null;
	const stageHeight = diningMapStageHeight(floor.floor.floorplan.canvas);
	const interactionSurface = (isZoomed: boolean) => (
		<DiningFloorplanInteractionSurface
			isZoomed={isZoomed}
			markup={prepared.markup}
			matchedWindowIds={matchedWindowIds}
			onSelectWindow={onSelectWindow}
			selectedAnchorId={selectedWindow?.svgAnchorId ?? null}
			windowByAnchorId={new Map(windows.map((window) => [window.svgAnchorId, window]))}
		/>
	);
	return (
		<>
			<div className="@container relative">
				<motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} key={floor.floor.floorId}>
					<Suspense
						fallback={
							<div
								className="relative min-w-0 overflow-hidden bg-[var(--dining-svg-canvas-bg)]"
								style={{ height: stageHeight }}
							>
								<div aria-hidden="true" className="h-full w-full" inert>
									<DiningFloorplanSvg markup={prepared.markup} />
								</div>
							</div>
						}
					>
						<DiningFloorplanZoom
							key={floor.floor.floorId}
							stageHeight={stageHeight}
							canvas={floor.floor.floorplan.canvas}
							floorId={floor.floor.floorId}
							initialViewport={
								initialViewport?.floorId === floor.floor.floorId ? initialViewport : undefined
							}
							onViewportChange={onViewportChange}
							onReady={onReady}
						>
							{interactionSurface}
						</DiningFloorplanZoom>
					</Suspense>
				</motion.div>
				<FloatingFloorSwitcher>{floorSwitcher}</FloatingFloorSwitcher>
			</div>
			<DiningWindowList
				className="border-border/70 border-t px-3 py-3 sm:px-4 lg:hidden"
				matchedWindowIds={matchedWindowIds}
				onSelectWindow={onSelectWindow}
				selectedWindowId={selectedWindowId}
				title="本层窗口"
				windows={windows}
			/>
		</>
	);
}

const DiningFloorplanInteractionSurface = memo(function DiningFloorplanInteractionSurface(props: {
	isZoomed: boolean;
	markup: string;
	matchedWindowIds: ReadonlySet<string> | null;
	onSelectWindow(windowId: string): void;
	selectedAnchorId: string | null;
	windowByAnchorId: ReadonlyMap<string, DiningWindowProjection>;
}) {
	const floorplanRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const root = floorplanRef.current;
		if (!root) {
			return;
		}
		for (const element of root.querySelectorAll<SVGElement>("[data-dining-anchor-id]")) {
			const anchorId = element.getAttribute("data-dining-anchor-id");
			const diningWindow = anchorId ? props.windowByAnchorId.get(anchorId) : null;
			const selected = Boolean(diningWindow && anchorId === props.selectedAnchorId);
			const selectable = Boolean(
				diningWindow &&
					(props.matchedWindowIds === null || props.matchedWindowIds.has(diningWindow.windowId)),
			);
			element.classList.toggle("is-selected", selected);
			element.classList.toggle("is-dimmed", Boolean(diningWindow) && !selectable);
			if (selectable && diningWindow) {
				element.setAttribute("role", "button");
				element.setAttribute("tabindex", "0");
				element.setAttribute("aria-label", `选择${diningWindow.name}`);
				element.setAttribute("aria-pressed", String(selected));
			} else {
				for (const attribute of ["role", "tabindex", "aria-label", "aria-pressed"]) {
					element.removeAttribute(attribute);
				}
			}
		}
	}, [props.matchedWindowIds, props.selectedAnchorId, props.windowByAnchorId]);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: annotated SVG groups own delegated keyboard and pointer interaction.
		<div
			className={props.isZoomed ? "h-full w-full touch-none" : "h-full w-full touch-pan-y"}
			data-testid="dining-floorplan-surface"
			onClick={(event) => {
				const diningWindow = windowForTarget(event.target, props.windowByAnchorId);
				if (diningWindow && isSelectable(diningWindow, props.matchedWindowIds)) {
					props.onSelectWindow(diningWindow.windowId);
				}
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") {
					return;
				}
				const diningWindow = windowForTarget(event.target, props.windowByAnchorId);
				if (diningWindow && isSelectable(diningWindow, props.matchedWindowIds)) {
					event.preventDefault();
					props.onSelectWindow(diningWindow.windowId);
				}
			}}
			ref={floorplanRef}
		>
			<DiningFloorplanSvg markup={props.markup} />
		</div>
	);
});

const DiningFloorplanSvg = memo(function DiningFloorplanSvg({ markup }: { markup: string }) {
	return (
		<div
			className="flex h-full w-full items-center justify-center [&_.dining-svg-anchor.is-dimmed]:cursor-default [&_.dining-svg-anchor.is-dimmed]:opacity-35 [&_.dining-svg-anchor[role=button]]:cursor-pointer [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-full"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin SVG is checked for executable content before mounting.
			dangerouslySetInnerHTML={{ __html: markup }}
		/>
	);
});

function prepareDiningFloorplanMarkup(input: {
	floor: DiningFloorResponse;
	rawMarkup: string;
	windows: DiningWindowProjection[];
}): { aspectRatio: string; markup: string } | null {
	try {
		const parser = new DOMParser();
		const document = parser.parseFromString(input.rawMarkup, "image/svg+xml");
		if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
			throw new Error("Dining floorplan asset is not valid SVG.");
		}
		assertSafeDiningSvg(document);
		const viewBox = parseDiningFloorplanViewBox(document.documentElement.getAttribute("viewBox"));
		const canvas = input.floor.floor.floorplan.canvas;
		if (canvas.width !== viewBox.width || canvas.height !== viewBox.height) {
			throw new Error("Dining floorplan canvas does not match its SVG.");
		}
		const anchorElements = [...document.querySelectorAll("[data-dining-anchor-id]")];
		document.documentElement.setAttribute("role", "group");
		for (const element of anchorElements) {
			const anchorId = element.getAttribute("data-dining-anchor-id") ?? "";
			const diningWindow = input.windows.find((window) => window.svgAnchorId === anchorId);
			if (!diningWindow) {
				element.remove();
				continue;
			}
			try {
				setDiningWindowLabel(element, diningWindow.name);
				element.setAttribute("data-dining-label", diningWindow.name);
				element.classList.add("dining-svg-anchor");
				element.setAttribute("data-testid", `dining-anchor-${anchorId}`);
				element.querySelector("[data-dining-anchor-hit]")?.classList.add("dining-svg-anchor-hit");
			} catch {
				// A malformed window must not hide the floor or disable its other windows.
				element.remove();
			}
		}
		appendDiningFloorplanInteractionStyles(document);
		return {
			aspectRatio: `${viewBox.width} / ${viewBox.height}`,
			markup: new XMLSerializer().serializeToString(document.documentElement),
		};
	} catch {
		return null;
	}
}

function setDiningWindowLabel(element: Element, label: string): void {
	const labelElement = element.querySelector<SVGTextElement>(
		"[data-dining-anchor-number], [data-dining-anchor-label]",
	);
	const hitShape = element.querySelector<SVGRectElement>("[data-dining-anchor-hit]");
	if (!(labelElement && hitShape)) {
		throw new Error("Dining floorplan anchor label is missing.");
	}
	const x = Number(hitShape.getAttribute("x"));
	const y = Number(hitShape.getAttribute("y"));
	const width = Number(hitShape.getAttribute("width"));
	const height = Number(hitShape.getAttribute("height"));
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
		throw new Error("Dining floorplan anchor has invalid geometry.");
	}
	const { fontSize, lines } = fitDiningWindowLabel(label, width, height);
	labelElement.removeAttribute("data-dining-anchor-number");
	labelElement.setAttribute("data-dining-anchor-label", "true");
	labelElement.classList.add("wayfinding-window-label");
	labelElement.replaceChildren();
	if (lines.length === 0) {
		labelElement.setAttribute("display", "none");
		return;
	}
	labelElement.removeAttribute("display");
	labelElement.setAttribute("x", String(x + width / 2));
	labelElement.setAttribute("y", String(y + height / 2 - (lines.length - 1) * (fontSize / 2)));
	if (fontSize === DINING_WINDOW_LABEL_MIN_SIZE) {
		labelElement.removeAttribute("style");
	} else {
		// Inline style beats the shared 16px label rule; boxes too small keep that rule.
		labelElement.setAttribute("style", `font-size: ${fontSize}px`);
	}
	labelElement.setAttribute("text-anchor", "middle");
	for (const [index, line] of lines.entries()) {
		const tspan = labelElement.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan");
		tspan.setAttribute("x", String(x + width / 2));
		if (index > 0) {
			tspan.setAttribute("dy", "1.1em");
		}
		tspan.textContent = line;
		labelElement.appendChild(tspan);
	}
}

const DINING_WINDOW_LABEL_MIN_SIZE = 16;
const DINING_WINDOW_LABEL_LARGER_SIZES = [22, 20, 18] as const;

/** 选择能完整放下名称且不增加行数的最大字号；否则沿用 16 单位的换行与截断。 */
export function fitDiningWindowLabel(
	label: string,
	width: number,
	height: number,
): { fontSize: number; lines: string[] } {
	const fullLabel = label.trim() || "窗口";
	const baseline = wrapDiningWindowLabel(label, width, height);
	for (const fontSize of DINING_WINDOW_LABEL_LARGER_SIZES) {
		const lines = wrapDiningWindowLabel(label, width, height, fontSize);
		// A larger size must show the whole name without adding a line break the 16-unit layout avoided.
		if (lines.join("") === fullLabel && lines.length <= Math.max(baseline.length, 1)) {
			return { fontSize, lines };
		}
	}
	return { fontSize: DINING_WINDOW_LABEL_MIN_SIZE, lines: baseline };
}

export function wrapDiningWindowLabel(
	label: string,
	width: number,
	height: number,
	fontSize: number = DINING_WINDOW_LABEL_MIN_SIZE,
): string[] {
	const characters = Array.from(label.trim() || "窗口");
	const charsPerLine = Math.floor((width - 16) / fontSize);
	if (charsPerLine < 1 || height < fontSize + 8) {
		return [];
	}
	const maxLines = height >= fontSize * 3.5 ? 2 : 1;
	if (characters.length <= charsPerLine) {
		return [characters.join("")];
	}
	const maxCharacters = charsPerLine * maxLines;
	if (characters.length <= maxCharacters) {
		return Array.from({ length: maxLines }, (_, index) =>
			characters.slice(index * charsPerLine, (index + 1) * charsPerLine).join(""),
		).filter(Boolean);
	}
	if (maxCharacters === 1) {
		return ["…"];
	}
	const clipped = characters.slice(0, maxCharacters - 1);
	return Array.from({ length: maxLines }, (_, index) =>
		clipped.slice(index * charsPerLine, (index + 1) * charsPerLine).join(""),
	)
		.filter(Boolean)
		.map((line, index, lines) => (index === lines.length - 1 ? `${line}…` : line));
}

function parseDiningFloorplanViewBox(value: string | null): { height: number; width: number } {
	const values = value?.trim().split(/\s+/).map(Number) ?? [];
	const width = values[2];
	const height = values[3];
	if (
		values.length !== 4 ||
		width === undefined ||
		height === undefined ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error("Dining floorplan SVG has an invalid viewBox.");
	}
	return { height, width };
}

function assertSafeDiningSvg(document: Document): void {
	if (document.querySelector("script, foreignObject, iframe, object, embed")) {
		throw new Error("Dining floorplan SVG contains a forbidden element.");
	}
	for (const element of document.querySelectorAll("*")) {
		for (const attribute of element.attributes) {
			if (attribute.name.toLowerCase().startsWith("on")) {
				throw new Error("Forbidden SVG handler.");
			}
			if (
				(attribute.name === "href" || attribute.name === "xlink:href") &&
				!attribute.value.startsWith("#")
			) {
				throw new Error("Forbidden SVG reference.");
			}
		}
	}
}

function appendDiningFloorplanInteractionStyles(document: Document): void {
	const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
	// Appended after the renderer's own <style>, so these theme tokens win at equal specificity.
	style.textContent = `
.wayfinding-canvas { fill: var(--dining-svg-canvas-bg); }
.wayfinding-surface { fill: var(--dining-svg-surface-bg); }
.wayfinding-outline { stroke: var(--dining-svg-outline); }
.wayfinding-structure { fill: var(--dining-svg-structure-bg); stroke: var(--dining-svg-structure-border); stroke-width: 1.5; }
.wayfinding-partition { stroke: var(--dining-svg-partition); stroke-width: 1.5; }
.wayfinding-region { fill: var(--dining-svg-region-bg); stroke: var(--dining-svg-region-border); }
.wayfinding-landmark { fill: var(--dining-svg-landmark-bg); stroke: var(--dining-svg-landmark-border); }
.wayfinding-region-label, .wayfinding-landmark-label { fill: var(--dining-svg-label); }
.wayfinding-icon, .wayfinding-entrance-line { stroke: var(--dining-svg-accent); }
.wayfinding-entrance-label { fill: var(--dining-svg-accent); }
.wayfinding-window { fill: var(--dining-svg-window-bg); stroke: var(--dining-svg-window-border); }
.wayfinding-window-number { fill: var(--dining-svg-window-text); }
.dining-svg-anchor { outline: none; transition: opacity var(--motion-duration-fast) var(--motion-easing-standard); }
.dining-svg-anchor-hit { transition: fill var(--motion-duration-fast) var(--motion-easing-standard), stroke var(--motion-duration-fast) var(--motion-easing-standard), stroke-width var(--motion-duration-fast) var(--motion-easing-standard); }
.wayfinding-window-label { fill: var(--dining-svg-window-text); font-size: 16px; font-weight: 650; }
.dining-svg-anchor.is-selected .dining-svg-anchor-hit { fill: var(--dining-window-selected-fill); stroke: var(--dining-window-selected-stroke); stroke-width: 4px; }
.dining-svg-anchor.is-selected .wayfinding-window-label { fill: var(--dining-window-selected-text); font-weight: 750; }
.dining-svg-anchor[role="button"]:not(.is-dimmed, .is-selected):is(:hover, :focus-visible) .dining-svg-anchor-hit { stroke: var(--dining-window-hover-stroke); stroke-width: 3px; }
.dining-svg-anchor[role="button"]:not(.is-dimmed):focus-visible .dining-svg-anchor-hit { stroke-width: 5px; }

@media (prefers-reduced-motion: reduce) { .dining-svg-anchor, .dining-svg-anchor-hit { transition: none; } }
`;
	document.documentElement.appendChild(style);
}

function windowForTarget(
	target: EventTarget | null,
	windows: ReadonlyMap<string, DiningWindowProjection>,
): DiningWindowProjection | null {
	if (!(target instanceof Element)) {
		return null;
	}
	const anchorId = target.closest("[data-dining-anchor-id]")?.getAttribute("data-dining-anchor-id");
	return anchorId ? (windows.get(anchorId) ?? null) : null;
}

function isSelectable(
	diningWindow: DiningWindowProjection,
	matchedWindowIds: ReadonlySet<string> | null,
): boolean {
	return matchedWindowIds === null || matchedWindowIds.has(diningWindow.windowId);
}
