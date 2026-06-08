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
	const canvas = floor.floor.canvas;
	return (
		<div className="overflow-auto rounded-xl border border-border bg-[var(--dining-svg-canvas-bg)] p-3">
			<div
				className="relative min-w-[640px] rounded-lg border border-border bg-white"
				style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
			>
				<img
					alt={`${floor.floor.label}平面图`}
					className="absolute inset-0 size-full object-contain"
					src={floor.floor.svgAssetUrl}
				/>
				{windows.map((window) => {
					const selected = window.windowId === selectedWindowId;
					return (
						<button
							aria-label={`选择${window.assignment?.stallProfile.displayName ?? window.label}`}
							className={cn(
								"absolute rounded-md border bg-white/90 px-2 text-left text-[11px] font-medium shadow-[var(--shadow-xs)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
								selected
									? "border-[var(--sys-text-strong)] bg-[var(--sys-text-strong)] text-white"
									: "border-[var(--sys-border-default)] text-[var(--sys-text-strong)] hover:border-primary",
							)}
							key={window.windowId}
							onClick={() => onSelectWindow(window.windowId)}
							style={{
								height: `${(window.geometry.height / canvas.height) * 100}%`,
								left: `${(window.geometry.x / canvas.width) * 100}%`,
								top: `${(window.geometry.y / canvas.height) * 100}%`,
								width: `${(window.geometry.width / canvas.width) * 100}%`,
							}}
							type="button"
						>
							<span className="line-clamp-2">
								{window.assignment?.stallProfile.displayName ?? window.label}
							</span>
						</button>
					);
				})}
			</div>
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
