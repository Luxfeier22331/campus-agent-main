import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningOfferingProjection,
	DiningWindowProjection,
} from "@/features/dining/model";
import { cn } from "@/lib/utils";
import { Card } from "../ui/card";

export function HallGrid({
	halls,
	onSelectHall,
	selectedHallId,
}: {
	halls: DiningHallSummary[];
	onSelectHall(hall: DiningHallSummary): void;
	selectedHallId: string;
}) {
	if (halls.length === 0) {
		return <p className="rounded-xl border border-border bg-white p-4 text-sm">没有匹配的食堂。</p>;
	}
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
			{halls.map((hall) => (
				<button
					className={cn(
						"aspect-square rounded-xl border border-border bg-white p-4 text-left shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--sys-text-strong)]",
						selectedHallId === hall.hallId &&
							"border-[var(--sys-text-strong)] bg-[var(--sys-bg-subtle)]",
					)}
					key={hall.hallId}
					onClick={() => onSelectHall(hall)}
					type="button"
				>
					<span className="text-xs font-medium text-[var(--sys-text-muted)]">{hall.campus}</span>
					<span className="mt-2 block text-xl font-semibold text-[var(--sys-text-strong)]">
						{hall.name}
					</span>
					<span className="mt-5 block text-sm text-[var(--sys-text-muted)]">
						{hall.floors.length} 层 · {hall.stallCount} 个窗口
					</span>
					<span className="mt-1 block text-sm font-medium text-primary">
						{hall.priceRangeLabel ?? "价格待发布"}
					</span>
					<span className="mt-4 line-clamp-2 text-xs leading-5 text-[var(--sys-text-subtle)]">
						{hall.tags.slice(0, 5).join(" / ")}
					</span>
				</button>
			))}
		</div>
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
		<div className="flex flex-wrap gap-2">
			<button
				className={cn(
					"min-h-9 rounded-full border border-border bg-white px-3 text-sm text-[var(--sys-text-muted)]",
					!selectedTag && "border-[var(--sys-text-strong)] text-[var(--sys-text-strong)]",
				)}
				onClick={() => onSelectTag(null)}
				type="button"
			>
				全部
			</button>
			{tags.map((tag) => (
				<button
					className={cn(
						"min-h-9 rounded-full border border-border bg-white px-3 text-sm text-[var(--sys-text-muted)]",
						selectedTag === tag && "border-[var(--sys-text-strong)] text-[var(--sys-text-strong)]",
					)}
					key={tag}
					onClick={() => onSelectTag(tag)}
					type="button"
				>
					{tag}
				</button>
			))}
		</div>
	);
}

export function InteractiveFloorplan({
	floor,
	onSelectWindow,
	selectedWindowId,
	windows,
}: {
	floor: DiningFloorResponse;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}) {
	const selectedWindow = windows.find((window) => window.windowId === selectedWindowId) ?? null;
	const normalizedMarkup = markDiningFloorplanAnchors(
		floor.floor.svgMarkup,
		windows,
		selectedWindow?.svgAnchorId ?? null,
	);
	return (
		<div className="overflow-auto rounded-xl border border-border bg-[var(--dining-svg-canvas-bg)] p-3">
			<fieldset
				className="min-w-[640px] rounded-lg border border-border bg-white p-2 [&_.dining-svg-anchor]:cursor-pointer [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:fill-[var(--sys-brand-interactive-subtle)] [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:stroke-primary [&_.dining-svg-anchor.is-selected_:is(rect,path,polygon,circle,ellipse)]:stroke-2 [&_.dining-svg-anchor:hover_:is(rect,path,polygon,circle,ellipse)]:stroke-primary [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
				data-testid="dining-inline-floorplan"
				onClick={(event) => {
					const target = event.target;
					if (!(target instanceof Element)) {
						return;
					}
					const anchorElement = target.closest("[data-dining-anchor-id]");
					const anchorId = anchorElement?.getAttribute("data-dining-anchor-id");
					const window = windows.find((item) => item.svgAnchorId === anchorId);
					if (window) {
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
					if (window) {
						event.preventDefault();
						onSelectWindow(window.windowId);
					}
				}}
			>
				<legend className="sr-only">食堂平面图窗口选择</legend>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: app-api returns sanitized published SVG and this component only annotates dining anchors for selection. */}
				<div dangerouslySetInnerHTML={{ __html: normalizedMarkup }} />
			</fieldset>
		</div>
	);
}

export function WindowList({
	onSelectWindow,
	selectedWindowId,
	windows,
}: {
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindowProjection[];
}) {
	if (windows.length === 0) {
		return <p className="rounded-xl border border-border bg-white p-4 text-sm">没有匹配的窗口。</p>;
	}
	return (
		<div className="max-h-[520px] overflow-auto rounded-xl border border-border bg-white">
			{windows.map((window) => (
				<button
					className={cn(
						"block w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-[var(--sys-bg-subtle)]",
						selectedWindowId === window.windowId && "bg-[var(--sys-brand-interactive-subtle)]",
					)}
					key={window.windowId}
					onClick={() => onSelectWindow(window.windowId)}
					type="button"
				>
					<span className="block text-sm font-medium text-[var(--sys-text-strong)]">
						{window.assignment?.stallProfile.displayName ?? window.label}
					</span>
					<span className="mt-1 block text-xs text-[var(--sys-text-muted)]">
						{window.locationLabel}
					</span>
				</button>
			))}
		</div>
	);
}

export function WindowDetail({ window }: { window: DiningWindowProjection | null }) {
	if (!window) {
		return (
			<p className="rounded-xl border border-border bg-white p-4 text-sm">
				选择窗口后查看菜品和价格。
			</p>
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
						<span
							className="rounded-full bg-[var(--sys-bg-muted)] px-2 py-1 text-xs text-[var(--sys-text-muted)]"
							key={tag}
						>
							{tag}
						</span>
					))}
				</div>
			</div>
			<div className="divide-y divide-border">
				{offerings.length > 0 ? (
					offerings.map((offering) => (
						<div className="grid grid-cols-[1fr_auto] gap-4 p-4" key={offering.offeringId}>
							<div>
								<p className="text-sm font-medium text-[var(--sys-text-strong)]">{offering.name}</p>
								<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
									{formatOfferingMeta(offering)}
								</p>
							</div>
							<p className="text-sm font-semibold text-primary">{offering.priceLabel}</p>
						</div>
					))
				) : (
					<p className="p-4 text-sm text-[var(--sys-text-muted)]">当前窗口没有已发布菜品。</p>
				)}
			</div>
		</Card>
	);
}

function formatOfferingMeta(offering: DiningOfferingProjection): string {
	return [offering.specLabel, formatSaleStatus(offering.saleStatus)].filter(Boolean).join(" · ");
}

function formatSaleStatus(status: "available" | "paused" | "seasonal"): string {
	if (status === "available") {
		return "可售";
	}
	if (status === "paused") {
		return "暂停";
	}
	return "季节供应";
}

function markDiningFloorplanAnchors(
	svgMarkup: string,
	windows: DiningWindowProjection[],
	selectedAnchorId: string | null,
): string {
	const parser = new DOMParser();
	const document = parser.parseFromString(svgMarkup, "image/svg+xml");
	const windowByAnchor = new Map(
		windows.flatMap((window) => (window.svgAnchorId ? [[window.svgAnchorId, window]] : [])),
	);
	for (const element of document.querySelectorAll("[data-dining-anchor-id]")) {
		const anchorId = element.getAttribute("data-dining-anchor-id");
		const window = anchorId ? windowByAnchor.get(anchorId) : null;
		element.classList.add("dining-svg-anchor");
		if (anchorId === selectedAnchorId) {
			element.classList.add("is-selected");
		}
		if (window && anchorId) {
			element.setAttribute("role", "button");
			element.setAttribute("tabindex", "0");
			element.setAttribute(
				"aria-label",
				`选择${window.assignment?.stallProfile.displayName ?? window.label}`,
			);
			element.setAttribute("data-testid", `dining-anchor-${anchorId}`);
		}
	}
	return new XMLSerializer().serializeToString(document.documentElement);
}
