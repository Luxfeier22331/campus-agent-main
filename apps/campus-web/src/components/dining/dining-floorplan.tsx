import { Button, cn } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { lazy, memo, Suspense, useLayoutEffect, useMemo, useRef } from "react";
import type { DiningFloorResponse, DiningWindowProjection } from "@/features/dining/model";
import { diningFloorplanAssetQueryOptions } from "@/features/dining/queries";

interface InteractiveFloorplanProps {
	floor: DiningFloorResponse;
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
	const query = useQuery(
		diningFloorplanAssetQueryOptions({
			floorplanId: floorplan.floorplanId,
			sha256: floorplan.sha256,
			svgAssetUrl: floorplan.svgAssetUrl,
		}),
	);
	if (query.isPending) {
		return <DiningFloorplanLoading aspectRatio={aspectRatio} />;
	}
	if (query.isError) {
		return (
			<DiningFloorplanUnavailable
				aspectRatio={aspectRatio}
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

function DiningFloorplanLoading({ aspectRatio }: { aspectRatio: string }) {
	return (
		<div
			aria-busy="true"
			aria-label="正在读取平面图"
			className="grid min-h-56 place-content-center gap-2 bg-[var(--dining-svg-canvas-bg)] px-5 text-center text-sm text-[var(--sys-text-muted)]"
			role="status"
			style={{ aspectRatio }}
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
	aspectRatio: string;
	matchedWindowIds: ReadonlySet<string> | null;
	onRetry?: () => void;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}) {
	const visibleWindows =
		props.matchedWindowIds === null
			? props.windows
			: props.windows.filter((window) => props.matchedWindowIds?.has(window.windowId));
	return (
		<section
			aria-label="平面图降级窗口列表"
			className="min-h-56 w-full min-w-0 max-w-full bg-destructive/5 px-4 py-5 sm:px-5"
		>
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
			<div className="mx-auto mt-4 w-full max-w-xl border-border/70 border-t pt-3">
				<p className="text-xs font-medium text-[var(--sys-text-subtle)]">窗口列表</p>
				{visibleWindows.length > 0 ? (
					<ul className="mt-2 grid min-w-0 list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
						{visibleWindows.map((window) => {
							const selected = window.windowId === props.selectedWindowId;
							return (
								<li className="min-w-0" key={window.windowId}>
									<Button
										aria-pressed={selected}
										className={cn(
											"min-h-11 w-full min-w-0 justify-start px-3 text-left",
											selected && "bg-selected text-selected-foreground hover:bg-selected-hover",
										)}
										onClick={() => props.onSelectWindow(window.windowId)}
										variant="ghost"
									>
										<span className="truncate">{window.name}</span>
									</Button>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="py-4 text-center text-sm text-[var(--sys-text-muted)]" role="status">
						{props.windows.length > 0 ? "没有匹配的窗口" : "当前楼层暂无窗口"}
					</p>
				)}
			</div>
		</section>
	);
}

function ResolvedInteractiveFloorplan({
	floor,
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
				aspectRatio={`${floor.floor.floorplan.canvas.width} / ${floor.floor.floorplan.canvas.height}`}
				matchedWindowIds={matchedWindowIds}
				onSelectWindow={onSelectWindow}
				selectedWindowId={selectedWindowId}
				windows={windows}
			/>
		);
	}
	const selectedWindow = windows.find((window) => window.windowId === selectedWindowId) ?? null;
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
		<Suspense
			fallback={
				<div
					className="relative min-w-0 overflow-hidden bg-[var(--dining-svg-canvas-bg)]"
					style={{ aspectRatio: prepared.aspectRatio }}
				>
					<div aria-hidden="true" className="h-full w-full" inert>
						<DiningFloorplanSvg markup={prepared.markup} />
					</div>
				</div>
			}
		>
			<DiningFloorplanZoom aspectRatio={prepared.aspectRatio}>
				{interactionSurface}
			</DiningFloorplanZoom>
		</Suspense>
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
			className="flex h-full w-full items-center justify-center p-2 md:p-3 [&_.dining-svg-anchor.is-dimmed]:cursor-default [&_.dining-svg-anchor.is-dimmed]:opacity-35 [&_.dining-svg-anchor[role=button]]:cursor-pointer [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-full"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin SVG is checksum-verified and structurally validated before mounting.
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
		const expectedAnchors = new Set(input.windows.map((window) => window.svgAnchorId));
		if (
			anchorElements.length !== expectedAnchors.size ||
			anchorElements.some(
				(element) => !expectedAnchors.has(element.getAttribute("data-dining-anchor-id") ?? ""),
			)
		) {
			throw new Error("Dining floorplan anchors do not match its projection.");
		}
		document.documentElement.setAttribute("role", "group");
		for (const element of anchorElements) {
			const anchorId = element.getAttribute("data-dining-anchor-id") ?? "";
			const diningWindow = input.windows.find((window) => window.svgAnchorId === anchorId);
			if (!diningWindow) {
				throw new Error("Dining floorplan anchor is unbound.");
			}
			setDiningWindowLabel(element, diningWindow.name);
			element.setAttribute("data-dining-label", diningWindow.name);
			element.classList.add("dining-svg-anchor");
			element.setAttribute("data-testid", `dining-anchor-${anchorId}`);
			const hitShape = element.querySelector("[data-dining-anchor-hit]");
			if (!hitShape) {
				throw new Error("Dining floorplan anchor is missing its hit shape.");
			}
			hitShape.classList.add("dining-svg-anchor-hit");
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
	const lines = wrapDiningWindowLabel(label, width, height);
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
	labelElement.setAttribute("y", String(y + height / 2 - (lines.length - 1) * 8));
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

export function wrapDiningWindowLabel(label: string, width: number, height: number): string[] {
	const characters = Array.from(label.trim() || "窗口");
	const charsPerLine = Math.floor((width - 16) / 16);
	if (charsPerLine < 1 || height < 24) {
		return [];
	}
	const maxLines = height >= 56 ? 2 : 1;
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
	style.textContent = `
.dining-svg-anchor { outline: none; transition: opacity 140ms ease-out; }
.dining-svg-anchor-hit { transition: fill 140ms ease-out, stroke-width 140ms ease-out; }
.wayfinding-window-label { fill: var(--sys-text-default); font-size: 16px; font-weight: 650; }
.dining-svg-anchor.is-selected .dining-svg-anchor-hit { fill: var(--campus-selected-bg); stroke: var(--campus-selected-border); stroke-width: 3px; }
.dining-svg-anchor[role="button"]:not(.is-dimmed):is(:hover, :focus-visible) .dining-svg-anchor-hit { stroke: var(--campus-selected-border); stroke-width: 3px; }
.dining-svg-anchor[role="button"]:not(.is-dimmed):focus-visible .dining-svg-anchor-hit { stroke-width: 5px; }
@media (max-width: 639px) { [data-dining-anchor-label] { font-size: 14px; } }
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
