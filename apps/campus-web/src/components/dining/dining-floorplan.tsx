import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { lazy, memo, Suspense, useLayoutEffect, useMemo, useRef } from "react";
import type { DiningFloorResponse, DiningWindowProjection } from "@/features/dining/model";
import { diningFloorplanAssetQueryOptions } from "@/features/dining/queries";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface InteractiveFloorplanProps {
	floor: DiningFloorResponse;
	matchedWindowIds: ReadonlySet<string> | null;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}

interface PreparedDiningFloorplan {
	aspectRatio: string;
	markup: string;
}

const DiningFloorplanZoom = lazy(() =>
	import("./dining-floorplan-zoom").then((module) => ({ default: module.DiningFloorplanZoom })),
);

export function InteractiveFloorplan(props: InteractiveFloorplanProps) {
	if (isPlaceholderDiningFloorplan(props.floor)) {
		return (
			<ResolvedInteractiveFloorplan
				{...props}
				isPlaceholder
				rawMarkup={buildPlaceholderFloorplanSvg(props.floor)}
			/>
		);
	}
	return <PublishedInteractiveFloorplan {...props} />;
}

function PublishedInteractiveFloorplan(props: InteractiveFloorplanProps) {
	const floorplan = props.floor.floor.floorplan;
	const aspectRatio = diningFloorplanAspectRatio(props.floor);
	if (floorplan.kind !== "asset") {
		return <DiningFloorplanUnavailable aspectRatio={aspectRatio} />;
	}
	const hasMatchingAssetReference =
		floorplan.floorId === props.floor.floor.floorId &&
		floorplan.hallId === props.floor.floor.hallId;
	if (!hasMatchingAssetReference) {
		return <DiningFloorplanUnavailable aspectRatio={aspectRatio} />;
	}
	return (
		<PublishedDiningFloorplanAsset {...props} aspectRatio={aspectRatio} floorplan={floorplan} />
	);
}

function PublishedDiningFloorplanAsset({
	aspectRatio,
	floorplan,
	...props
}: InteractiveFloorplanProps & {
	aspectRatio: string;
	floorplan: Extract<DiningFloorResponse["floor"]["floorplan"], { kind: "asset" }>;
}) {
	const floorplanQuery = useQuery(
		diningFloorplanAssetQueryOptions({
			floorplanId: floorplan.floorplanId,
			sha256: floorplan.sha256,
			svgAssetUrl: floorplan.svgAssetUrl,
		}),
	);

	if (floorplanQuery.isPending) {
		return <DiningFloorplanLoading aspectRatio={aspectRatio} />;
	}
	if (floorplanQuery.isError) {
		return (
			<DiningFloorplanUnavailable
				aspectRatio={aspectRatio}
				onRetry={() => void floorplanQuery.refetch()}
			/>
		);
	}
	return (
		<ResolvedInteractiveFloorplan
			{...props}
			isPlaceholder={false}
			rawMarkup={floorplanQuery.data}
		/>
	);
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

function DiningFloorplanUnavailable({
	aspectRatio,
	onRetry,
}: {
	aspectRatio: string;
	onRetry?: () => void;
}) {
	return (
		<div
			aria-label="平面图暂时无法显示"
			className="grid min-h-56 place-content-center gap-2 bg-destructive/5 px-5 text-center"
			role="alert"
			style={{ aspectRatio }}
		>
			<h3 className="text-sm font-semibold text-[var(--sys-text-strong)]">平面图暂时无法显示</h3>
			<p className="text-sm text-[var(--sys-text-muted)]">平面图数据暂时不可用，请稍后再试。</p>
			{onRetry ? (
				<Button
					className="mx-auto mt-1"
					onClick={onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					重试
				</Button>
			) : null}
		</div>
	);
}

function ResolvedInteractiveFloorplan({
	floor,
	isPlaceholder,
	matchedWindowIds,
	onSelectWindow,
	rawMarkup,
	selectedWindowId,
	windows,
}: InteractiveFloorplanProps & { isPlaceholder: boolean; rawMarkup: string }) {
	const preparedMarkup = useMemo(
		() => prepareDiningFloorplanMarkup({ floor, isPlaceholder, rawMarkup, windows }),
		[floor, isPlaceholder, rawMarkup, windows],
	);
	if (!preparedMarkup) {
		return <DiningFloorplanUnavailable aspectRatio={diningFloorplanAspectRatio(floor)} />;
	}
	const selectedWindow = windows.find((window) => window.windowId === selectedWindowId) ?? null;
	const floorplanKey = `${floor.floor.hallId}:${floor.floor.floorId}:${floor.floor.floorplan.floorplanId}:${floor.floor.floorplan.kind === "asset" ? floor.floor.floorplan.sha256 : "placeholder"}`;
	return (
		<DiningFloorplanSurface
			aspectRatio={preparedMarkup.aspectRatio}
			isPlaceholder={isPlaceholder}
			key={floorplanKey}
			markup={preparedMarkup.markup}
			matchedWindowIds={matchedWindowIds}
			onSelectWindow={onSelectWindow}
			selectedWindow={selectedWindow}
			windows={windows}
		/>
	);
}

function DiningFloorplanSurface({
	aspectRatio,
	isPlaceholder,
	matchedWindowIds,
	markup,
	onSelectWindow,
	selectedWindow,
	windows,
}: {
	aspectRatio: string;
	isPlaceholder: boolean;
	matchedWindowIds: ReadonlySet<string> | null;
	markup: string;
	onSelectWindow(windowId: string): void;
	selectedWindow: DiningWindowProjection | null;
	windows: DiningWindowProjection[];
}) {
	const windowByAnchorId = useMemo(
		() => mapWindowsByAnchor(windows, isPlaceholder),
		[isPlaceholder, windows],
	);
	const selectedAnchorId = selectedWindow
		? resolveDiningAnchorId(selectedWindow, isPlaceholder)
		: null;
	const placeholderBadge = isPlaceholder ? (
		<Badge
			className="absolute bottom-3 left-3 z-20 bg-white/95 text-muted-foreground"
			variant="secondary"
		>
			地图待补充
		</Badge>
	) : null;
	const interactionSurface = (isZoomed: boolean) => (
		<DiningFloorplanInteractionSurface
			isZoomed={isZoomed}
			markup={markup}
			matchedWindowIds={matchedWindowIds}
			onSelectWindow={onSelectWindow}
			selectedAnchorId={selectedAnchorId}
			windowByAnchorId={windowByAnchorId}
		/>
	);

	return (
		<Suspense
			fallback={
				<>
					<div
						className="relative min-w-0 overflow-hidden bg-[var(--dining-svg-canvas-bg)]"
						data-testid="dining-inline-floorplan"
						style={{ aspectRatio }}
					>
						{placeholderBadge}
						<span className="sr-only" role="status">
							正在启用地图交互
						</span>
						<div aria-hidden="true" className="h-full w-full" inert>
							<DiningFloorplanSvg markup={markup} />
						</div>
					</div>
					<div aria-hidden="true" className="min-h-14 border-border/70 border-t" />
				</>
			}
		>
			<DiningFloorplanZoom aspectRatio={aspectRatio} overlay={placeholderBadge}>
				{interactionSurface}
			</DiningFloorplanZoom>
		</Suspense>
	);
}

const DiningFloorplanInteractionSurface = memo(function DiningFloorplanInteractionSurface({
	isZoomed,
	markup,
	matchedWindowIds,
	onSelectWindow,
	selectedAnchorId,
	windowByAnchorId,
}: {
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
			const diningWindow = anchorId ? windowByAnchorId.get(anchorId) : null;
			if (!anchorId) {
				continue;
			}
			const isAssigned = Boolean(diningWindow?.assignment);
			const isSelected = Boolean(diningWindow && anchorId === selectedAnchorId);
			const isSelectable = diningWindow
				? isWindowSelectable(diningWindow, matchedWindowIds)
				: false;
			element.classList.toggle("is-selected", isSelected);
			element.classList.toggle("is-dimmed", isAssigned && !(isSelected || isSelectable));
			if (isSelectable && diningWindow) {
				element.setAttribute("role", "button");
				element.setAttribute("tabindex", "0");
				element.setAttribute("aria-label", `选择${displayLabelForWindow(diningWindow)}`);
				element.setAttribute("aria-pressed", String(isSelected));
			} else {
				element.removeAttribute("role");
				element.removeAttribute("tabindex");
				element.removeAttribute("aria-label");
				element.removeAttribute("aria-pressed");
			}
		}
	}, [matchedWindowIds, selectedAnchorId, windowByAnchorId]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: this delegates pointer and keyboard events to annotated SVG button anchors.
		<div
			className={isZoomed ? "h-full w-full touch-none" : "h-full w-full touch-pan-y"}
			data-testid="dining-floorplan-surface"
			onClick={(event) => {
				const diningWindow = windowForTarget(event.target, windowByAnchorId);
				if (diningWindow && isWindowSelectable(diningWindow, matchedWindowIds)) {
					onSelectWindow(diningWindow.windowId);
				}
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") {
					return;
				}
				const diningWindow = windowForTarget(event.target, windowByAnchorId);
				if (diningWindow && isWindowSelectable(diningWindow, matchedWindowIds)) {
					event.preventDefault();
					onSelectWindow(diningWindow.windowId);
				}
			}}
			ref={floorplanRef}
		>
			<DiningFloorplanSvg markup={markup} />
		</div>
	);
});

const DiningFloorplanSvg = memo(function DiningFloorplanSvg({ markup }: { markup: string }) {
	return (
		<div
			className="flex h-full w-full items-center justify-center p-2 md:p-3 [&_.dining-svg-anchor.is-dimmed]:cursor-default [&_.dining-svg-anchor.is-dimmed]:opacity-35 [&_.dining-svg-anchor[role=button]]:cursor-pointer [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-full"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: the same-origin SVG is checksum-verified and structurally validated before mounting.
			dangerouslySetInnerHTML={{ __html: markup }}
		/>
	);
});

function mapWindowsByAnchor(
	windows: DiningWindowProjection[],
	isPlaceholder: boolean,
): Map<string, DiningWindowProjection> {
	return new Map(
		windows.flatMap((diningWindow) => {
			const anchorId = resolveDiningAnchorId(diningWindow, isPlaceholder);
			return anchorId ? [[anchorId, diningWindow]] : [];
		}),
	);
}

function windowForTarget(
	target: EventTarget | null,
	windowByAnchorId: ReadonlyMap<string, DiningWindowProjection>,
): DiningWindowProjection | null {
	if (!(target instanceof Element)) {
		return null;
	}
	const anchorId = target.closest("[data-dining-anchor-id]")?.getAttribute("data-dining-anchor-id");
	return anchorId ? (windowByAnchorId.get(anchorId) ?? null) : null;
}

function isPlaceholderDiningFloorplan(floor: DiningFloorResponse): boolean {
	return floor.floor.floorplan.kind === "placeholder";
}

function prepareDiningFloorplanMarkup(input: {
	floor: DiningFloorResponse;
	isPlaceholder: boolean;
	rawMarkup: string;
	windows: DiningWindowProjection[];
}): PreparedDiningFloorplan | null {
	try {
		const parser = new DOMParser();
		const document = parser.parseFromString(input.rawMarkup, "image/svg+xml");
		if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
			throw new Error("Dining floorplan asset is not valid SVG.");
		}
		assertSafeDiningSvg(document);
		const viewBox = parseDiningFloorplanViewBox(document.documentElement.getAttribute("viewBox"));
		if (!input.isPlaceholder) {
			assertPublishedFloorplanBindings({ document, floor: input.floor, windows: input.windows });
			assertDiningFloorplanCanvas({ floor: input.floor, viewBox });
		}
		const windowByAnchorId = mapWindowsByAnchor(input.windows, input.isPlaceholder);
		if ([...windowByAnchorId.values()].some((diningWindow) => diningWindow.assignment)) {
			document.documentElement.setAttribute("role", "group");
		}
		const description = document.querySelector("desc");
		if (description) {
			description.textContent = "档口名称、就餐区域和入口位置示意图。";
		}
		for (const element of document.querySelectorAll("[data-dining-anchor-id]")) {
			const anchorId = element.getAttribute("data-dining-anchor-id");
			const diningWindow = anchorId ? windowByAnchorId.get(anchorId) : null;
			if (!anchorId) {
				continue;
			}
			if (!diningWindow?.assignment) {
				element.remove();
				continue;
			}
			const displayLabel = displayLabelForWindow(diningWindow);
			setDiningWindowLabel(element, displayLabel);
			element.setAttribute("data-dining-label", displayLabel);
			element.classList.add("dining-svg-anchor");
			element.setAttribute("data-testid", `dining-anchor-${anchorId}`);
			element.setAttribute("role", "button");
			element.setAttribute("tabindex", "0");
			element.setAttribute("aria-label", `选择${displayLabel}`);
			element.setAttribute("aria-pressed", "false");
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
		throw new Error("Dining floorplan anchor is missing its visible label.");
	}
	const x = Number(hitShape.getAttribute("x"));
	const y = Number(hitShape.getAttribute("y"));
	const width = Number(hitShape.getAttribute("width"));
	const height = Number(hitShape.getAttribute("height"));
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
		throw new Error("Dining floorplan anchor has invalid label geometry.");
	}

	const lines = wrapDiningWindowLabel(label, width, height);
	labelElement.removeAttribute("data-dining-anchor-number");
	labelElement.setAttribute("data-dining-anchor-label", "true");
	labelElement.classList.remove("wayfinding-window-number");
	labelElement.classList.add("wayfinding-window-label");
	labelElement.setAttribute("x", String(x + width / 2));
	labelElement.setAttribute("y", String(y + height / 2 - (lines.length - 1) * 8));
	labelElement.setAttribute("text-anchor", "middle");
	while (labelElement.firstChild) {
		labelElement.removeChild(labelElement.firstChild);
	}
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

function wrapDiningWindowLabel(label: string, width: number, height: number): string[] {
	const characters = Array.from(label.trim() || "窗口");
	const charsPerLine = Math.max(4, Math.floor((width - 16) / 16));
	const maxLines = height >= 56 ? 2 : 1;
	if (characters.length <= charsPerLine) {
		return [characters.join("")];
	}
	const windowSuffix = Array.from("窗口");
	const prefix = characters.slice(0, -windowSuffix.length);
	if (
		maxLines >= 2 &&
		characters.slice(-windowSuffix.length).join("") === windowSuffix.join("") &&
		prefix.length > 0 &&
		prefix.length <= charsPerLine
	) {
		return [prefix.join(""), windowSuffix.join("")];
	}
	const maxCharacters = charsPerLine * maxLines;
	if (characters.length <= maxCharacters) {
		return Array.from({ length: maxLines }, (_, index) =>
			characters.slice(index * charsPerLine, (index + 1) * charsPerLine).join(""),
		).filter(Boolean);
	}
	const visibleCharacters = Math.max(1, maxCharacters - 1);
	const clipped = characters.slice(0, visibleCharacters);
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
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error("Dining floorplan SVG has an invalid viewBox.");
	}
	return { height, width };
}

function assertDiningFloorplanCanvas(input: {
	floor: DiningFloorResponse;
	viewBox: { height: number; width: number };
}): void {
	if (
		input.floor.floor.floorplan.canvas.width !== input.viewBox.width ||
		input.floor.floor.floorplan.canvas.height !== input.viewBox.height
	) {
		throw new Error("Dining floorplan SVG viewBox does not match its projection canvas.");
	}
}

function diningFloorplanAspectRatio(floor: DiningFloorResponse): string {
	return `${floor.floor.floorplan.canvas.width} / ${floor.floor.floorplan.canvas.height}`;
}

function assertSafeDiningSvg(document: Document): void {
	if (document.querySelector("script, foreignObject, iframe, object, embed")) {
		throw new Error("Dining floorplan SVG contains a forbidden element.");
	}
	for (const element of document.querySelectorAll("*")) {
		for (const attribute of element.attributes) {
			if (attribute.name.toLowerCase().startsWith("on")) {
				throw new Error("Dining floorplan SVG contains an event handler.");
			}
			if (
				(attribute.name === "href" || attribute.name === "xlink:href") &&
				!attribute.value.startsWith("#")
			) {
				throw new Error("Dining floorplan SVG contains an external reference.");
			}
		}
	}
}

function assertPublishedFloorplanBindings(input: {
	document: Document;
	floor: DiningFloorResponse;
	windows: DiningWindowProjection[];
}): void {
	const assetAnchorIds = [...input.document.querySelectorAll("[data-dining-anchor-id]")].map(
		(element) => element.getAttribute("data-dining-anchor-id") ?? "",
	);
	const publishedAnchorIds = input.floor.floor.floorplan.anchorInventory.map(
		(anchor) => anchor.anchorId,
	);
	if (assetAnchorIds.join("\u0000") !== publishedAnchorIds.join("\u0000")) {
		throw new Error("Dining floorplan anchor inventory does not match its projection.");
	}
	const availableAnchors = new Set(assetAnchorIds);
	const boundAnchors = new Set<string>();
	for (const diningWindow of input.windows) {
		if (
			!(diningWindow.svgAnchorId && availableAnchors.has(diningWindow.svgAnchorId)) ||
			boundAnchors.has(diningWindow.svgAnchorId)
		) {
			throw new Error("Dining window binding does not match its floorplan projection.");
		}
		boundAnchors.add(diningWindow.svgAnchorId);
	}
}

function appendDiningFloorplanInteractionStyles(svgDocument: Document): void {
	const style = svgDocument.createElementNS("http://www.w3.org/2000/svg", "style");
	style.setAttribute("data-dining-interaction-styles", "true");
	style.textContent = `
.dining-svg-anchor {
	outline: none;
	transition: opacity 140ms ease-out;
}
.dining-svg-anchor-hit {
	transition: fill 140ms ease-out, stroke-width 140ms ease-out;
}
.wayfinding-window-label {
	fill: #263442;
	font-size: 16px;
	font-weight: 650;
}
.dining-svg-anchor.is-selected .dining-svg-anchor-hit {
	fill: var(--sys-brand-interactive-subtle);
	stroke: var(--sys-brand-interactive);
	stroke-width: 3px;
}
.dining-svg-anchor[role="button"]:not(.is-dimmed):is(:hover, :focus-visible) .dining-svg-anchor-hit {
	stroke: var(--sys-brand-interactive);
	stroke-width: 3px;
}
.dining-svg-anchor[role="button"]:not(.is-dimmed):focus-visible .dining-svg-anchor-hit {
	stroke-width: 5px;
}
@media (max-width: 639px) {
	[data-dining-anchor-label] { font-size: 14px; }
}
@media (prefers-reduced-motion: reduce) {
	.dining-svg-anchor,
	.dining-svg-anchor-hit { transition: none; }
}
`;
	svgDocument.documentElement.appendChild(style);
}

function isWindowSelectable(
	diningWindow: DiningWindowProjection,
	matchedWindowIds: ReadonlySet<string> | null,
): boolean {
	return matchedWindowIds === null || matchedWindowIds.has(diningWindow.windowId);
}

function resolveDiningAnchorId(
	diningWindow: DiningWindowProjection,
	isPlaceholder: boolean,
): string | null {
	return diningWindow.svgAnchorId ?? (isPlaceholder ? diningWindow.windowId : null);
}

function buildPlaceholderFloorplanSvg(floor: DiningFloorResponse): string {
	const canvas = floor.floor.floorplan.canvas;
	const width = Math.max(canvas.width, 720);
	const height = Math.max(canvas.height, 420);
	const title = escapeSvgText(floor.floor.label);
	const windows = [...floor.windows]
		.sort((left, right) => left.windowId.localeCompare(right.windowId))
		.map((diningWindow, index) => {
			const anchorId = escapeSvgAttribute(diningWindow.svgAnchorId ?? diningWindow.windowId);
			const label = `${index + 1}号窗口`;
			const number = String(index + 1).padStart(2, "0");
			const x = 64 + (index % 3) * 180;
			const y = 72 + Math.floor(index / 3) * 112;
			const itemWidth = 150;
			const itemHeight = 72;
			return `<g data-dining-role="window" data-dining-anchor-id="${anchorId}" data-dining-label="${label}"><rect data-dining-anchor-hit="true" x="${x}" y="${y}" width="${itemWidth}" height="${itemHeight}" rx="8" fill="#fbfbf8" stroke="#b8c3d1"/><text data-dining-anchor-number="true" x="${x + itemWidth / 2}" y="${y + itemHeight / 2 + 7}" text-anchor="middle" font-size="20" font-weight="700" fill="#334155">${number}</text></g>`;
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

function displayLabelForWindow(diningWindow: DiningWindowProjection): string {
	return diningWindow.assignment?.stallProfile.displayName ?? diningWindow.label;
}
