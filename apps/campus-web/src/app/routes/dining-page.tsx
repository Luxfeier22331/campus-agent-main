import { Button } from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	DiningHallSwitcher,
	DiningMapToolbar,
	DiningWindowDetail,
	InteractiveFloorplan,
} from "@/components/dining/dining-experience";
import { DiningPageSkeleton } from "@/components/dining/dining-page-skeleton";
import { SurfaceState } from "@/components/ui/surface-state";
import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningSearchResult,
} from "@/features/dining/model";
import { diningMapQueryOptions } from "@/features/dining/queries";
import { diningQueryClient } from "@/features/dining/query-client";

export function DiningPage() {
	return (
		<QueryClientProvider client={diningQueryClient}>
			<DiningPageContent />
		</QueryClientProvider>
	);
}

export function DiningPageContent() {
	const navigate = useNavigate({ from: "/dining" });
	const routeSearch = useSearch({ from: "/dining" });
	const detailRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const dining = useQuery(diningMapQueryOptions());
	const halls = dining.data?.halls ?? [];
	const selectedHall = halls.find((hall) => hall.hallId === routeSearch.hall) ?? halls[0] ?? null;
	const selectedFloor =
		selectedHall?.floors.find((floor) => floor.floorId === routeSearch.floor) ??
		selectedHall?.floors[0] ??
		null;
	const selectedWindow =
		selectedFloor?.windows.find((window) => window.windowId === routeSearch.window) ?? null;
	const activeFloor: DiningFloorResponse | null =
		selectedHall && selectedFloor
			? {
					floor: { ...selectedFloor, hallId: selectedHall.hallId },
					windows: selectedFloor.windows,
				}
			: null;
	const searchResults = useMemo(
		() => searchDiningWindows(selectedHall, query),
		[query, selectedHall],
	);
	const matchedWindowIds = useMemo(() => {
		if (!(query.trim() && selectedFloor)) {
			return null;
		}
		return new Set(
			searchResults
				.filter((result) => result.floorId === selectedFloor.floorId)
				.map((result) => result.windowId),
		);
	}, [query, searchResults, selectedFloor]);

	useEffect(() => {
		if (!(selectedHall && selectedFloor)) {
			return;
		}
		if (
			routeSearch.hall !== selectedHall.hallId ||
			routeSearch.floor !== selectedFloor.floorId ||
			(routeSearch.window && !selectedWindow)
		) {
			void navigate({
				replace: true,
				search: {
					floor: selectedFloor.floorId,
					hall: selectedHall.hallId,
					item: selectedWindow ? routeSearch.item : undefined,
					window: selectedWindow?.windowId,
				},
			});
		}
	}, [
		navigate,
		routeSearch.floor,
		routeSearch.hall,
		routeSearch.item,
		routeSearch.window,
		selectedFloor,
		selectedHall,
		selectedWindow,
	]);

	function selectHall(hall: DiningHallSummary): void {
		const floor = hall.floors[0];
		void navigate({
			search: { floor: floor?.floorId, hall: hall.hallId, item: undefined, window: undefined },
		});
	}

	function selectFloor(floorId: string): void {
		if (!selectedHall) {
			return;
		}
		void navigate({
			search: { floor: floorId, hall: selectedHall.hallId, item: undefined, window: undefined },
		});
	}

	function selectWindow(windowId: string): void {
		if (!(selectedHall && selectedFloor)) {
			return;
		}
		void navigate({
			search: {
				floor: selectedFloor.floorId,
				hall: selectedHall.hallId,
				item: undefined,
				window: windowId,
			},
		});
		if (window.matchMedia("(max-width: 1023px)").matches) {
			window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
		}
	}

	function selectSearchResult(result: DiningSearchResult): void {
		void navigate({
			search: {
				floor: result.floorId,
				hall: result.hallId,
				item: undefined,
				window: result.windowId,
			},
		});
	}

	return (
		<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-4 pb-40 sm:px-5 sm:py-6 sm:pb-24 lg:px-6">
			<h1 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
				食堂地图
			</h1>
			{dining.isPending ? <DiningPageSkeleton includeHallSwitcher /> : null}
			{dining.isError ? (
				<SurfaceState
					className="mt-5"
					description="食堂地图暂时无法读取。"
					kind="error"
					primaryAction={<Button onClick={() => void dining.refetch()}>重试</Button>}
					secondaryAction={
						<Button asChild variant="outline">
							<a href="/feedback?source=dining">反馈</a>
						</Button>
					}
					title="食堂地图不可用"
				/>
			) : null}
			{dining.data && halls.length === 0 ? (
				<SurfaceState className="mt-5 border-dashed" kind="empty" title="暂无食堂地图" />
			) : null}
			{dining.data && selectedHall && selectedFloor && activeFloor ? (
				<div className="mt-4 space-y-4">
					<DiningHallSwitcher
						halls={halls}
						onSelectHall={selectHall}
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
								onQueryChange={setQuery}
								onSelectFloor={selectFloor}
								onSelectResult={selectSearchResult}
								query={query}
								searchResults={searchResults}
								selectedFloorId={selectedFloor.floorId}
							/>
							<InteractiveFloorplan
								floor={activeFloor}
								matchedWindowIds={matchedWindowIds}
								onSelectWindow={selectWindow}
								selectedWindowId={selectedWindow?.windowId ?? null}
								windows={activeFloor.windows}
							/>
							<div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-border/70 border-t px-3 text-xs text-[var(--sys-text-subtle)] sm:px-4">
								<span>更新于 {formatDiningDate(dining.data.updatedAt)}</span>
								<a
									className="inline-flex min-h-11 items-center text-primary hover:underline"
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
								onSelectMenuItem={(item) =>
									void navigate({
										search: {
											floor: selectedFloor.floorId,
											hall: selectedHall.hallId,
											item: item ?? undefined,
											window: selectedWindow?.windowId,
										},
									})
								}
								selectedMenuItemId={routeSearch.item ?? null}
								window={selectedWindow}
							/>
						</div>
					</div>
				</div>
			) : null}
		</section>
	);
}

export function searchDiningWindows(
	hall: DiningHallSummary | null,
	query: string,
): DiningSearchResult[] {
	const normalized = query.trim().toLocaleLowerCase("zh-CN");
	if (!(hall && normalized)) {
		return [];
	}
	return hall.floors.flatMap((floor) =>
		floor.windows.flatMap((window) =>
			window.name.toLocaleLowerCase("zh-CN").includes(normalized)
				? [
						{
							campus: hall.campus,
							floorId: floor.floorId,
							floorLabel: floor.label,
							hallId: hall.hallId,
							hallName: hall.name,
							windowId: window.windowId,
							windowName: window.name,
						},
					]
				: [],
		),
	);
}

function formatDiningDate(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
		new Date(value),
	);
}
