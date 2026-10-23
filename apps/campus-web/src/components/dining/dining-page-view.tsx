import { Button, Card, cn, StateMessage } from "@campus-agent/ui";
import { ChevronDown, X } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, type RefObject, useState } from "react";
import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningMapResponse,
	DiningSearchResult,
	DiningWindowProjection,
} from "@/features/dining/model";
import { formatCalendarTime, formatTimestamp } from "@/lib/date-time";
import { CampusMotionProvider, stateSwap } from "../ui/motion";
import { DiningFloorSwitcher, DiningHallSwitcher, DiningWindowSearch } from "./dining-controls";
import { DiningWindowDetail, InteractiveFloorplan } from "./dining-experience";
import type { DiningMapViewport } from "./dining-map-interaction";
import { DiningPageSkeleton } from "./dining-page-skeleton";

export interface DiningPageViewProps {
	initialViewport?: DiningMapViewport | undefined;
	onViewportChange?: ((viewport: DiningMapViewport) => void) | undefined;
	onMapReady?: (() => void) | undefined;
	headerActions?: ReactNode;
	windowExtra?: ReactNode;
	activeFloor: DiningFloorResponse | null;
	data: DiningMapResponse | null;
	isError: boolean;
	isPending: boolean;
	mapRef: RefObject<HTMLElement | null>;
	matchedWindowIds: ReadonlySet<string> | null;
	onClearWindow: () => void;
	onOpenFeedback?: (() => void) | undefined;
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
	initialViewport,
	onViewportChange,
	onMapReady,
	headerActions,
	windowExtra,
	activeFloor,
	data,
	isError,
	isPending,
	mapRef,
	matchedWindowIds,
	onClearWindow,
	onOpenFeedback,
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
	// Collapsing applies to one window only; choosing another window opens its detail again.
	const [collapsedWindowId, setCollapsedWindowId] = useState<string | null>(null);
	const detailExpanded = !selectedWindow || collapsedWindowId !== selectedWindow.windowId;

	function closeDetail() {
		// The close button unmounts with the panel; hand focus back to the window it described.
		const anchor = mapRef.current?.querySelector<SVGElement>(".dining-svg-anchor.is-selected");
		onClearWindow();
		anchor?.focus({ preventScroll: true });
	}

	return (
		<CampusMotionProvider>
			<section
				className={cn(
					"mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-4 pb-40 sm:px-5 sm:py-6 sm:pb-24 lg:px-6",
					// The mobile detail panel covers up to 55dvh; keep the page scrollable above it.
					selectedWindow && "max-lg:pb-[60dvh]",
				)}
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="ui-page-title">食堂地图</h1>
					{headerActions}
				</div>
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
							<Button className="min-h-11" onClick={onOpenFeedback} variant="outline">
								反馈
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
					<>
						<div
							className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6"
							data-testid="dining-selection-panel"
						>
							<div className="min-w-0">
								<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
									<DiningHallSwitcher
										className="sm:w-56 sm:shrink-0"
										halls={halls}
										onSelectHall={onSelectHall}
										selectedHallId={selectedHall.hallId}
									/>
									<DiningWindowSearch
										className="sm:flex-1"
										onQueryChange={onQueryChange}
										onSelectResult={onSelectResult}
										query={query}
										searchResults={searchResults}
										selectedFloorId={selectedFloor.floorId}
									/>
								</div>
								<Card asChild>
									<section
										aria-label="平面图"
										className="min-w-0 scroll-mt-20 overflow-hidden"
										data-testid="dining-map-panel"
										ref={mapRef}
									>
										<InteractiveFloorplan
											initialViewport={initialViewport}
											onViewportChange={onViewportChange}
											onReady={onMapReady}
											floor={activeFloor}
											floorSwitcher={
												<DiningFloorSwitcher
													floors={selectedHall.floors}
													onSelectFloor={onSelectFloor}
													selectedFloorId={selectedFloor.floorId}
												/>
											}
											matchedWindowIds={matchedWindowIds}
											onSelectWindow={onSelectWindow}
											selectedWindowId={selectedWindow?.windowId ?? null}
											windows={activeFloor.windows}
										/>
									</section>
								</Card>
								<p className="mt-1 flex flex-wrap items-center justify-between gap-x-3 px-1 text-xs text-[var(--sys-text-subtle)]">
									<span>
										地图更新于{" "}
										<time dateTime={data.updatedAt} title={formatTimestamp(data.updatedAt)}>
											{formatCalendarTime(data.updatedAt)}
										</time>
									</span>
									<button
										className="inline-flex min-h-11 items-center text-link hover:text-link-hover hover:underline"
										onClick={onOpenFeedback}
										type="button"
									>
										信息有误？反馈
									</button>
								</p>
							</div>
							<aside
								aria-label="窗口详情"
								className={cn(
									"min-w-0 bg-card lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:rounded-[var(--radius-xl)] lg:border lg:border-border/70 lg:px-5",
									selectedWindow
										? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-[var(--layer-domain)] max-lg:max-h-[55dvh] max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:rounded-t-2xl max-lg:border-border/70 max-lg:border-t max-lg:px-4 max-lg:pb-[env(safe-area-inset-bottom)] max-lg:shadow-[var(--shadow-lg)]"
										: "max-lg:hidden",
								)}
								data-testid="dining-detail-panel"
							>
								<motion.div key={selectedWindow?.windowId ?? "empty"} {...stateSwap}>
									<DiningWindowDetail
										collapsed={!detailExpanded}
										headerAction={
											selectedWindow ? (
												<div className="-my-2 -mr-2 flex shrink-0 items-center lg:hidden">
													<Button
														aria-expanded={detailExpanded}
														aria-label={detailExpanded ? "收起窗口详情" : "展开窗口详情"}
														onClick={() =>
															setCollapsedWindowId(detailExpanded ? selectedWindow.windowId : null)
														}
														size="icon-lg"
														variant="ghost"
													>
														<ChevronDown
															aria-hidden="true"
															className={cn(
																"transition-transform duration-[var(--motion-duration-fast)] motion-reduce:transition-none",
																!detailExpanded && "rotate-180",
															)}
														/>
													</Button>
													<Button
														aria-label="关闭窗口详情"
														onClick={closeDetail}
														size="icon-lg"
														variant="ghost"
													>
														<X aria-hidden="true" />
													</Button>
												</div>
											) : null
										}
										noMatches={matchedWindowIds?.size === 0}
										floorLabel={selectedFloor.label}
										onSelectMenuItem={onSelectMenuItem}
										selectedMenuItemId={selectedMenuItemId}
										window={selectedWindow}
									/>
									<div className={cn(!detailExpanded && "max-lg:hidden")}>{windowExtra}</div>
								</motion.div>
							</aside>
						</div>
					</>
				) : null}
			</section>
		</CampusMotionProvider>
	);
}
