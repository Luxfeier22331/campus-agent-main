import { getDiningFloorplanByFloor } from "dining-floorplans";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningWindowProjection,
} from "@/features/dining/model";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function HallSelector({
	halls,
	onSelectHall,
	selectedHallId,
}: {
	halls: DiningHallSummary[];
	onSelectHall(hall: DiningHallSummary): void;
	selectedHallId: string;
}) {
	if (halls.length === 0) {
		return (
			<Card className="flex min-h-32 flex-col items-center justify-center border-dashed px-6 py-8 text-center">
				<h3 className="font-medium text-foreground text-sm">没有匹配的食堂、档口或菜品</h3>
				<p className="mt-1 max-w-sm text-muted-foreground text-sm">调整搜索词或筛选条件后再试。</p>
			</Card>
		);
	}
	return (
		<ul className="flex list-none gap-2 overflow-x-auto p-0 pb-1">
			{halls.map((hall) => (
				<li className="shrink-0" key={hall.hallId}>
					<Button
						className={cn(
							"min-h-10 rounded-lg border border-border bg-white px-4 text-sm text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] hover:border-[var(--sys-text-strong)]",
							selectedHallId === hall.hallId &&
								"border-[var(--sys-text-strong)] bg-[var(--sys-text-strong)] text-white hover:text-white",
						)}
						onClick={() => onSelectHall(hall)}
						variant="secondary"
					>
						{hall.name}
					</Button>
				</li>
			))}
		</ul>
	);
}

export function TagFilters({
	onSelectTag,
	selectedTag,
	tags,
}: {
	onSelectTag(tag: string | null): void;
	selectedTag: string | null;
	tags: string[];
}) {
	return (
		<ToggleGroup
			aria-label="餐饮标签"
			className="flex-wrap justify-start"
			onValueChange={(value) => onSelectTag(value && value !== "all" ? value : null)}
			type="single"
			value={selectedTag ?? "all"}
		>
			<ToggleGroupItem className="rounded-full" value="all">
				全部
			</ToggleGroupItem>
			{tags.map((tag) => (
				<ToggleGroupItem className="rounded-full" key={tag} value={tag}>
					{tag}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

export function StallList({
	onSelectWindow,
	selectedWindowId,
	windows,
}: {
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}) {
	if (windows.length === 0) {
		return (
			<Card className="flex min-h-32 flex-col items-center justify-center border-dashed bg-white px-6 py-8 text-center">
				<h3 className="font-medium text-foreground text-sm">没有匹配的档口</h3>
				<p className="mt-1 max-w-sm text-muted-foreground text-sm">
					当前筛选条件下没有可显示档口。
				</p>
			</Card>
		);
	}
	return (
		<div className="min-w-0 max-h-[360px] overflow-auto rounded-xl border border-border bg-white">
			{windows.map((window) => (
				<Button
					className={cn(
						"flex min-h-16 w-full flex-col items-start justify-center rounded-none border-b border-border px-4 py-3 text-left whitespace-normal last:border-b-0 hover:bg-[var(--sys-bg-subtle)]",
						selectedWindowId === window.windowId && "bg-[var(--sys-brand-interactive-subtle)]",
					)}
					key={window.windowId}
					onClick={() => onSelectWindow(window.windowId)}
					variant="ghost"
				>
					<span className="block text-sm font-medium text-[var(--sys-text-strong)]">
						{window.assignment?.stallProfile.displayName ?? window.label}
					</span>
				</Button>
			))}
		</div>
	);
}

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
			wheel={{ step: 0.04 }}
			pinch={{ step: 3 }}
		>
			<DiningFloorplanZoomSurface
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
	matchedWindowIds,
	markup,
	onSelectWindow,
	selectedZoomTarget,
	windows,
}: {
	matchedWindowIds: ReadonlySet<string> | null;
	markup: string;
	onSelectWindow(windowId: string): void;
	selectedZoomTarget: string | null;
	windows: DiningWindowProjection[];
}) {
	const { centerView, resetTransform, zoomIn, zoomOut, zoomToElement } = useControls();
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
		<div className="min-w-0 rounded-xl border border-border bg-[var(--dining-svg-canvas-bg)] p-3">
			<div
				className="mb-2 flex flex-wrap justify-end gap-2"
				role="toolbar"
				aria-label="平面图视图控制"
			>
				<Button
					aria-label="放大平面图"
					className="text-[var(--sys-text-muted)] hover:text-[var(--sys-text-strong)]"
					onClick={() => zoomIn(0.15, 120)}
					size="icon"
					variant="secondary"
				>
					<ZoomIn aria-hidden="true" className="size-4" />
				</Button>
				<Button
					aria-label="缩小平面图"
					className="text-[var(--sys-text-muted)] hover:text-[var(--sys-text-strong)]"
					onClick={() => zoomOut(0.15, 120)}
					size="icon"
					variant="secondary"
				>
					<ZoomOut aria-hidden="true" className="size-4" />
				</Button>
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
			<TransformComponent
				contentClass="!w-full !max-w-full"
				wrapperClass="min-w-0 !w-full !max-w-full overflow-hidden rounded-lg border border-border bg-white"
			>
				<div
					className="w-full rounded-lg p-2 [&_.dining-svg-anchor.is-dimmed]:cursor-default [&_.dining-svg-anchor.is-dimmed]:opacity-35 [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:fill-[var(--sys-brand-interactive-subtle)] [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:stroke-primary [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:stroke-2 [&_.dining-svg-anchor:not(.is-dimmed)]:cursor-pointer [&_.dining-svg-anchor:not(.is-dimmed):hover_:is(rect,path,polygon,circle,ellipse)]:stroke-primary [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
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

export function StallDetail({ window }: { window: DiningWindowProjection | null }) {
	if (!window) {
		return (
			<Card className="flex min-h-32 flex-col items-center justify-center border-dashed bg-white px-6 py-8 text-center">
				<h3 className="font-medium text-foreground text-sm">选择档口</h3>
				<p className="mt-1 max-w-sm text-muted-foreground text-sm">
					选择地图或列表里的档口后查看菜品。
				</p>
			</Card>
		);
	}
	const offerings = window.assignment?.offerings ?? [];
	return (
		<Card className="overflow-hidden">
			<div className="border-b border-border p-4">
				<p className="text-xs font-medium text-[var(--sys-text-muted)]">{window.locationLabel}</p>
				<h2 className="mt-2 text-xl font-semibold text-[var(--sys-text-strong)]">
					{window.assignment?.stallProfile.displayName ?? window.label}
				</h2>
				<div className="mt-3 flex flex-wrap gap-2">
					{window.tags.map((tag) => (
						<Badge className="bg-muted text-muted-foreground" key={tag} variant="secondary">
							{tag}
						</Badge>
					))}
				</div>
			</div>
			<div className="divide-y divide-border">
				{offerings.length > 0 ? (
					offerings.map((offering) => (
						<div className="grid grid-cols-[1fr_auto] gap-4 p-4" key={offering.offeringId}>
							<div>
								<p className="text-sm font-medium text-[var(--sys-text-strong)]">{offering.name}</p>
							</div>
							<div className="text-right">
								<p className="text-xs text-[var(--sys-text-muted)]">参考价格</p>
								<p className="text-sm font-semibold text-primary">{offering.priceLabel}</p>
							</div>
						</div>
					))
				) : (
					<div className="m-4 flex min-h-24 flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-8 text-center">
						<h3 className="font-medium text-foreground text-sm">暂无菜品</h3>
						<p className="mt-1 max-w-sm text-muted-foreground text-sm">当前档口没有已发布菜品。</p>
					</div>
				)}
			</div>
		</Card>
	);
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
			if (isWindowSelectable(window, matchedWindowIds)) {
				element.setAttribute("role", "button");
				element.setAttribute("tabindex", "0");
				element.setAttribute(
					"aria-label",
					`选择${window.assignment?.stallProfile.displayName ?? window.label}`,
				);
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
