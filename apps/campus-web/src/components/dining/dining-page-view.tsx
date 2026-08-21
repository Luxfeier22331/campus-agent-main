import { Button } from "@campus-agent/ui";
import type { RefObject } from "react";
import { StateMessage } from "@/components/ui/state-message";
import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningMapResponse,
	DiningSearchResult,
	DiningWindowProjection,
} from "@/features/dining/model";
import {
	DiningHallSwitcher,
	DiningMapToolbar,
	DiningWindowDetail,
	InteractiveFloorplan,
} from "./dining-experience";
import { DiningPageSkeleton } from "./dining-page-skeleton";

export interface DiningPageViewProps {
	activeFloor: DiningFloorResponse | null;
	data: DiningMapResponse | null;
	detailRef: RefObject<HTMLDivElement | null>;
	isError: boolean;
	isPending: boolean;
	matchedWindowIds: ReadonlySet<string> | null;
	onRetry: () => void;
	onQueryChange: (query: string) => void;
	onSelectFloor: (floorId: string) => void;
	onSelectHall: (hall: DiningHallSummary) => void;
	onSelectMenuItem: (itemId: string | null) => void;
	onSelectResult: (result: DiningSearchResult) => void;
	onSelectWindow: (windowId: string) => void;
	query: string;
	searchResults: DiningSearchResult[];
	selectedFloor: DiningHallSummary["floors"][number] | null;
	selectedHall: DiningHallSummary | null;
	selectedMenuItemId: string | null;
	selectedWindow: DiningWindowProjection | null;
}

export function DiningPageView({
	activeFloor,
	data,
	detailRef,
	isError,
	isPending,
	matchedWindowIds,
	onRetry,
	onQueryChange,
	onSelectFloor,
	onSelectHall,
	onSelectMenuItem,
	onSelectResult,
	onSelectWindow,
	query,
	searchResults,
	selectedFloor,
	selectedHall,
	selectedMenuItemId,
	selectedWindow,
}: DiningPageViewProps) {
	const halls = data?.halls ?? [];

	return (
		<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-4 pb-40 sm:px-5 sm:py-6 sm:pb-24 lg:px-6">
			<h1 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
				食堂地图
			</h1>
			{isPending ? <DiningPageSkeleton includeHallSwitcher /> : null}
			{isError ? (
				<StateMessage
					className="mt-5"
					description="食堂地图暂时无法读取。"
					layout="section"
					primaryAction={
						<Button className="min-h-11" onClick={onRetry}>
							重试
						</Button>
					}
					secondaryAction={
						<Button asChild variant="outline">
							<a href="/feedback?source=dining">反馈</a>
						</Button>
					}
					role="alert"
					title="食堂地图不可用"
					tone="danger"
				/>
			) : null}
			{data && halls.length === 0 ? (
				<StateMessage
					className="mt-5"
					description="当前没有可展示的食堂和楼层。"
					layout="section"
					title="暂无食堂地图"
				/>
			) : null}
			{data && selectedHall && selectedFloor && activeFloor ? (
				<div className="mt-4 space-y-4">
					<DiningHallSwitcher
						halls={halls}
						onSelectHall={onSelectHall}
						selectedHallId={selectedHall.hallId}
					/>
					<div
						className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6"
						data-testid="dining-selection-panel"
					>
						<section
							className="min-w-0 overflow-hidden rounded-lg border border-border/80 bg-card"
							data-testid="dining-map-panel"
						>
							<DiningMapToolbar
								floors={selectedHall.floors}
								onQueryChange={onQueryChange}
								onSelectFloor={onSelectFloor}
								onSelectResult={onSelectResult}
								query={query}
								searchResults={searchResults}
								selectedFloorId={selectedFloor.floorId}
							/>
							<InteractiveFloorplan
								floor={activeFloor}
								matchedWindowIds={matchedWindowIds}
								onSelectWindow={onSelectWindow}
								selectedWindowId={selectedWindow?.windowId ?? null}
								windows={activeFloor.windows}
							/>
							<div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-border/70 border-t px-3 text-xs text-[var(--sys-text-subtle)] sm:px-4">
								<span>更新于 {formatDiningDate(data.updatedAt)}</span>
								<a
									className="inline-flex min-h-11 items-center text-link hover:text-link-hover hover:underline"
									href="/feedback?source=dining"
								>
									信息有误？反馈
								</a>
							</div>
						</section>
						<div
							className="min-w-0 scroll-mt-28 border-border/70 border-t pt-4 lg:sticky lg:top-20 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"
							data-testid="dining-detail-panel"
							ref={detailRef}
						>
							<DiningWindowDetail
								floorLabel={selectedFloor.label}
								onSelectMenuItem={onSelectMenuItem}
								selectedMenuItemId={selectedMenuItemId}
								window={selectedWindow}
							/>
						</div>
					</div>
				</div>
			) : null}
		</section>
	);
}

export function formatDiningDate(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
		new Date(value),
	);
}
