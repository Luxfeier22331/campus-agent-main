import { Button } from "@campus-agent/ui";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	DiningHallSwitcher,
	DiningMapToolbar,
	DiningReviews,
	type DiningReviewsState,
	InteractiveFloorplan,
	StallDetail,
} from "@/components/dining/dining-experience";
import { DiningPageSkeleton } from "@/components/dining/dining-page-skeleton";
import { SurfaceState } from "@/components/ui/surface-state";
import type {
	DiningHallSummary,
	DiningOfferingProjection,
	DiningSearchResult,
} from "@/features/dining/model";
import { classifyDiningPublicationChange } from "@/features/dining/publication";
import {
	diningBootstrapQueryOptions,
	diningFloorQueryOptions,
	diningPublicationQueryOptions,
	diningReviewsQueryOptions,
	diningSearchQueryOptions,
	prefetchDiningFloor,
} from "@/features/dining/queries";
import { diningQueryClient } from "@/features/dining/query-client";

interface DiningLocalSelection {
	floorId: string;
	hallId: string;
	offeringId: string | null;
	windowId: string;
}

const REVIEW_LOADING_DELAY_MS = 150;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function DiningPage() {
	return (
		<QueryClientProvider client={diningQueryClient}>
			<DiningPageContent />
		</QueryClientProvider>
	);
}

export function DiningPageContent() {
	const queryClient = useQueryClient();
	const locationSearch = useLocation({ select: (location) => location.searchStr });
	const navigate = useNavigate({ from: "/dining" });
	const routeSearch = useSearch({ from: "/dining" });
	const detailRef = useRef<HTMLDivElement>(null);
	const reviewRef = useRef<HTMLElement>(null);
	const [query, setQuery] = useState("");
	const [selection, setSelection] = useState<DiningLocalSelection | null>(null);
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const debouncedQuery = useDebouncedValue(query, 200);
	const bootstrapQuery = useQuery(diningBootstrapQueryOptions());
	const publicationQuery = useQuery(diningPublicationQueryOptions());
	const previousPublicationRef = useRef(publicationQuery.data);
	const halls = bootstrapQuery.data?.halls ?? [];
	const selectedHall = halls.find((hall) => hall.hallId === routeSearch.hall) ?? halls[0] ?? null;
	const selectedHallId = selectedHall?.hallId ?? "";
	const selectedFloor =
		selectedHall?.floors.find((floor) => floor.floorId === routeSearch.floor) ??
		selectedHall?.floors[0] ??
		null;
	const selectedFloorId = selectedFloor?.floorId ?? "";
	const initialFloor = bootstrapQuery.data?.initial?.floor;
	const hasInitialFloor =
		initialFloor?.floor.hallId === selectedHallId && initialFloor.floor.floorId === selectedFloorId;
	const floorQuery = useQuery(
		diningFloorQueryOptions({
			floorId: selectedFloorId,
			hallId: selectedHallId,
			initialData: hasInitialFloor ? initialFloor : undefined,
			initialDataUpdatedAt: hasInitialFloor ? bootstrapQuery.dataUpdatedAt : undefined,
		}),
	);
	const floor = floorQuery.data ?? null;
	const activeFloor =
		floor?.floor.hallId === selectedHallId && floor.floor.floorId === selectedFloorId
			? floor
			: null;
	const selectionMatchesFloor =
		selection?.hallId === selectedHallId && selection.floorId === selectedFloorId;
	const selectedWindow = selectionMatchesFloor
		? (activeFloor?.windows.find((diningWindow) => diningWindow.windowId === selection.windowId) ??
			null)
		: null;
	const selectedWindowId = selectedWindow?.windowId ?? null;
	const selectedOfferings = selectedWindow?.assignment?.offerings ?? [];
	const selectedOffering = resolveSelectedDiningOffering({
		offerings: selectedOfferings,
		selectedOfferingId: selectionMatchesFloor ? (selection?.offeringId ?? null) : null,
	});
	const selectedOfferingId = selectedOffering?.offeringId ?? null;
	const reviewsQuery = useQuery(
		diningReviewsQueryOptions({ offeringId: selectedOfferingId ?? "" }),
	);
	const [loadingVisualOfferingId, setLoadingVisualOfferingId] = useState<string | null>(null);
	const revealedOfferingIdRef = useRef<string | null>(null);
	useEffect(() => {
		setLoadingVisualOfferingId(null);
		if (!(selectedOfferingId && reviewsQuery.isPending)) {
			return;
		}
		const timeout = window.setTimeout(
			() => setLoadingVisualOfferingId(selectedOfferingId),
			REVIEW_LOADING_DELAY_MS,
		);
		return () => window.clearTimeout(timeout);
	}, [reviewsQuery.isPending, selectedOfferingId]);
	const searchQuery = useQuery(
		diningSearchQueryOptions({
			query: debouncedQuery,
			scopeHallId: selectedHallId,
			tag: selectedTag,
		}),
	);
	const hasActiveSearch = query.trim().length > 0 || selectedTag !== null;
	const searchResults = hasActiveSearch ? (searchQuery.data?.results ?? []) : [];
	const matchedWindowIds = useMemo(() => {
		if (!hasActiveSearch) {
			return null;
		}
		return new Set(
			searchResults
				.filter((result) => result.hallId === selectedHallId && result.floorId === selectedFloorId)
				.map((result) => result.windowId),
		);
	}, [hasActiveSearch, searchResults, selectedFloorId, selectedHallId]);
	const campusTags = useMemo(
		() =>
			selectedHall
				? uniqueStrings(
						halls
							.filter((hall) => hall.campus === selectedHall.campus)
							.flatMap((hall) => hall.tags),
					)
				: [],
		[halls, selectedHall],
	);
	const hallsError =
		bootstrapQuery.isError && !bootstrapQuery.data ? "食堂信息暂时无法读取。" : null;
	const floorError = floorQuery.isError && !floorQuery.data ? "食堂平面图暂时无法打开。" : null;
	const hasReviewsError = Boolean(selectedOffering && reviewsQuery.isError && !reviewsQuery.data);
	const showReviewsSkeleton = Boolean(
		selectedOfferingId && reviewsQuery.isPending && loadingVisualOfferingId === selectedOfferingId,
	);
	const reviewsState: DiningReviewsState = selectedOffering
		? reviewsQuery.isPending
			? { showSkeleton: showReviewsSkeleton, status: "pending" }
			: hasReviewsError
				? { message: "评价暂时无法读取。", status: "error" }
				: { reviews: reviewsQuery.data?.reviews ?? [], status: "ready" }
		: { status: "idle" };
	const canRevealReviews = Boolean(
		selectedOfferingId && (!reviewsQuery.isPending || showReviewsSkeleton),
	);
	const isLoadingHalls = bootstrapQuery.isPending;
	const isLoadingFloor = Boolean(selectedHallId && selectedFloorId && floorQuery.isPending);
	const isFloorPending = Boolean(selectedHallId && selectedFloorId && !activeFloor && !floorError);
	const hasRetiredSelectionParams = useMemo(() => {
		const params = new URLSearchParams(locationSearch);
		return params.has("window") || params.has("offering");
	}, [locationSearch]);

	useEffect(() => {
		const previous = previousPublicationRef.current;
		const current = publicationQuery.data;
		previousPublicationRef.current = current;
		if (!(previous && current)) {
			return;
		}
		const change = classifyDiningPublicationChange(previous, current);
		if (change === "catalog") {
			setSelection(null);
			void queryClient.invalidateQueries({
				predicate: (query) => query.queryKey[0] === "dining" && query.queryKey[1] !== "publication",
			});
			return;
		}
		if (change === "reviews") {
			void queryClient.invalidateQueries({ queryKey: ["dining", "reviews"] });
		}
	}, [publicationQuery.data, queryClient]);

	useEffect(() => {
		if (!selectedOfferingId) {
			revealedOfferingIdRef.current = null;
			return;
		}
		if (!canRevealReviews || revealedOfferingIdRef.current === selectedOfferingId) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			revealDiningReview(reviewRef.current);
			revealedOfferingIdRef.current = selectedOfferingId;
		});
		return () => window.cancelAnimationFrame(frame);
	}, [canRevealReviews, selectedOfferingId]);

	useEffect(() => {
		if (!(bootstrapQuery.data && selectedHall && selectedFloor)) {
			return;
		}
		if (
			routeSearch.hall === selectedHall.hallId &&
			routeSearch.floor === selectedFloor.floorId &&
			!hasRetiredSelectionParams
		) {
			return;
		}
		void navigate({
			replace: true,
			search: {
				floor: selectedFloor.floorId,
				hall: selectedHall.hallId,
			},
		});
	}, [
		bootstrapQuery.data,
		navigate,
		hasRetiredSelectionParams,
		routeSearch.floor,
		routeSearch.hall,
		selectedFloor,
		selectedHall,
	]);

	useEffect(() => {
		setSelection((current) => {
			if (!current) {
				return current;
			}
			if (current.hallId !== selectedHallId || current.floorId !== selectedFloorId) {
				return null;
			}
			if (!activeFloor) {
				return current;
			}
			const diningWindow = activeFloor.windows.find((item) => item.windowId === current.windowId);
			if (!diningWindow) {
				return null;
			}
			const offeringIsValid = current.offeringId
				? diningWindow.assignment?.offerings.some(
						(offering) => offering.offeringId === current.offeringId,
					) === true
				: true;
			return offeringIsValid ? current : { ...current, offeringId: null };
		});
	}, [activeFloor, selectedFloorId, selectedHallId]);

	useEffect(() => {
		if (!(activeFloor && selectedHall)) {
			return;
		}
		for (const siblingFloor of selectedHall.floors) {
			if (siblingFloor.floorId !== selectedFloorId) {
				void prefetchDiningFloor(queryClient, {
					floorId: siblingFloor.floorId,
					hallId: selectedHall.hallId,
				});
			}
		}
	}, [activeFloor, queryClient, selectedFloorId, selectedHall]);

	useEffect(() => {
		if (!selectedWindowId) {
			return;
		}
		let innerFrame = 0;
		let settleTimer = 0;
		const outerFrame = window.requestAnimationFrame(() => {
			innerFrame = window.requestAnimationFrame(() => {
				revealDiningDetail(detailRef.current);
				settleTimer = window.setTimeout(() => revealDiningDetail(detailRef.current), 160);
			});
		});
		return () => {
			window.cancelAnimationFrame(outerFrame);
			if (innerFrame) {
				window.cancelAnimationFrame(innerFrame);
			}
			if (settleTimer) {
				window.clearTimeout(settleTimer);
			}
		};
	}, [selectedWindowId]);

	function selectHall(hall: DiningHallSummary) {
		const floorId = hall.floors[0]?.floorId;
		if (!floorId || (hall.hallId === selectedHallId && floorId === selectedFloorId)) {
			return;
		}
		clearLocalSearch();
		setSelection(null);
		void navigate({
			search: { floor: floorId, hall: hall.hallId },
		});
	}

	function selectFloor(floorId: string) {
		if (floorId === selectedFloorId) {
			return;
		}
		clearLocalSearch();
		setSelection(null);
		void navigate({
			search: { floor: floorId, hall: selectedHallId },
		});
	}

	function selectWindow(windowId: string) {
		const diningWindow = activeFloor?.windows.find((item) => item.windowId === windowId);
		if (!diningWindow) {
			return;
		}
		if (selectedWindowId === windowId) {
			revealDiningDetail(detailRef.current);
			return;
		}
		setSelection({
			floorId: selectedFloorId,
			hallId: selectedHallId,
			offeringId: null,
			windowId,
		});
	}

	function selectOffering(offeringId: string) {
		if (!selectedWindowId) {
			return;
		}
		setSelection({
			floorId: selectedFloorId,
			hallId: selectedHallId,
			offeringId,
			windowId: selectedWindowId,
		});
	}

	function retryReviews() {
		setLoadingVisualOfferingId(null);
		void reviewsQuery.refetch();
	}

	function selectSearchResult(result: DiningSearchResult) {
		setSelection({
			floorId: result.floorId,
			hallId: result.hallId,
			offeringId: result.offering?.offeringId ?? null,
			windowId: result.windowId,
		});
		void navigate({
			search: {
				floor: result.floorId,
				hall: result.hallId,
			},
		});
	}

	function updateQuery(nextQuery: string) {
		setQuery(nextQuery);
		clearSelection();
	}

	function selectTag(tag: string | null) {
		setSelectedTag(tag);
		clearSelection();
	}

	function clearFilters() {
		clearLocalSearch();
		clearSelection();
	}

	function clearLocalSearch() {
		setQuery("");
		setSelectedTag(null);
	}

	function clearSelection() {
		setSelection(null);
	}

	function prefetchHall(hall: DiningHallSummary) {
		for (const hallFloor of hall.floors) {
			void prefetchDiningFloor(queryClient, {
				floorId: hallFloor.floorId,
				hallId: hall.hallId,
			});
		}
	}

	function prefetchFloor(floorId: string) {
		if (selectedHallId) {
			void prefetchDiningFloor(queryClient, { floorId, hallId: selectedHallId });
		}
	}

	function prefetchSearchResult(result: DiningSearchResult) {
		void prefetchDiningFloor(queryClient, { floorId: result.floorId, hallId: result.hallId });
	}

	return (
		<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-4 pb-40 sm:px-5 sm:py-6 sm:pb-24 lg:px-6">
			<h1 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
				食堂
			</h1>

			{hallsError ? (
				<SurfaceState
					className="mt-5"
					description={hallsError}
					kind="error"
					primaryAction={
						<Button onClick={() => void bootstrapQuery.refetch()} type="button">
							重试
						</Button>
					}
					secondaryAction={
						<Button asChild variant="outline">
							<a href="/feedback?source=dining">反馈</a>
						</Button>
					}
					title="食堂数据不可用"
				/>
			) : null}
			{isLoadingHalls && !hallsError ? <DiningPageSkeleton includeHallSwitcher /> : null}
			{!isLoadingHalls && halls.length === 0 && !hallsError ? (
				<SurfaceState
					className="mt-5 border-dashed text-center"
					description="暂时没有可展示的食堂信息。"
					kind="empty"
					title="暂无内容"
				/>
			) : null}
			{halls.length > 0 && !hallsError ? (
				<div className="mt-4 space-y-4">
					<DiningHallSwitcher
						halls={halls}
						onPrefetchHall={prefetchHall}
						onSelectHall={selectHall}
						selectedHallId={selectedHallId}
					/>
					{floorError ? (
						<DiningWorkspaceState>
							<SurfaceState
								className="w-full max-w-lg"
								description={floorError}
								kind="error"
								primaryAction={
									<Button onClick={() => void floorQuery.refetch()} type="button">
										重试
									</Button>
								}
								title="食堂地图不可用"
							/>
						</DiningWorkspaceState>
					) : isLoadingFloor || isFloorPending ? (
						<DiningPageSkeleton />
					) : activeFloor && selectedHall ? (
						<div className="space-y-6">
							<div
								className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6"
								data-testid="dining-selection-panel"
							>
								<section
									className="min-w-0 overflow-hidden rounded-lg border border-border/80 bg-card"
									data-testid="dining-map-panel"
								>
									<DiningMapToolbar
										campus={selectedHall.campus}
										floorLabel={activeFloor.floor.label}
										floors={selectedHall.floors}
										hasActiveSearch={hasActiveSearch}
										onClearFilters={clearFilters}
										onPrefetchFloor={prefetchFloor}
										onPrefetchResult={prefetchSearchResult}
										onQueryChange={updateQuery}
										onRetrySearch={() => void searchQuery.refetch()}
										onSelectFloor={selectFloor}
										onSelectResult={selectSearchResult}
										onSelectTag={selectTag}
										query={query}
										searchError={searchQuery.isError ? "搜索暂时不可用。" : null}
										searchIsLoading={
											query.trim() !== debouncedQuery.trim() || searchQuery.isPending
										}
										searchResults={searchResults}
										searchTotal={searchQuery.data?.total ?? 0}
										selectedFloorId={selectedFloorId}
										selectedTag={selectedTag}
										tags={campusTags}
									/>
									<InteractiveFloorplan
										floor={activeFloor}
										matchedWindowIds={matchedWindowIds}
										onSelectWindow={selectWindow}
										selectedWindowId={selectedWindow?.windowId ?? null}
										windows={activeFloor.windows}
									/>
									<div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-border/70 border-t px-3 text-xs text-[var(--sys-text-subtle)] sm:px-4">
										<span>信息更新于 {formatDiningDate(activeFloor.source.updatedAt)}</span>
										<a
											className="inline-flex min-h-11 items-center text-primary hover:underline"
											href="/feedback?source=dining"
										>
											信息有误？反馈
										</a>
									</div>
								</section>
								<div
									className="min-w-0 scroll-mt-28 border-border/70 border-t pt-4 md:scroll-mt-20 lg:sticky lg:top-20 lg:self-start lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"
									data-testid="dining-detail-panel"
									ref={detailRef}
								>
									<StallDetail
										onSelectOffering={selectOffering}
										selectedOfferingId={selectedOffering?.offeringId ?? null}
										window={selectedWindow}
									/>
								</div>
							</div>
							<DiningReviews onRetry={retryReviews} ref={reviewRef} state={reviewsState} />
						</div>
					) : (
						<DiningWorkspaceState>
							<SurfaceState
								className="w-full max-w-lg border-dashed text-center"
								description="暂时没有可展示的食堂地图。"
								kind="empty"
								title="暂无内容"
							/>
						</DiningWorkspaceState>
					)}
				</div>
			) : null}
		</section>
	);
}

function DiningWorkspaceState({ children }: { children: ReactNode }) {
	return (
		<div className="grid min-h-[clamp(420px,65dvh,680px)] place-items-center rounded-lg border border-border bg-card p-4">
			{children}
		</div>
	);
}

function resolveSelectedDiningOffering(input: {
	offerings: DiningOfferingProjection[];
	selectedOfferingId: string | null;
}): DiningOfferingProjection | null {
	return (
		input.offerings.find((offering) => offering.offeringId === input.selectedOfferingId) ?? null
	);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debouncedValue, setDebouncedValue] = useState(value);
	useEffect(() => {
		const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
		return () => window.clearTimeout(timeout);
	}, [delayMs, value]);
	return debouncedValue;
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
		left.localeCompare(right, "zh-CN"),
	);
}

function formatDiningDate(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(
		new Date(value),
	);
}

function revealDiningDetail(detail: HTMLDivElement | null): void {
	if (!detail) {
		return;
	}
	const detailRect = detail.getBoundingClientRect();
	const mapPanel = detail
		.closest('[data-testid="dining-selection-panel"]')
		?.querySelector<HTMLElement>('[data-testid="dining-map-panel"]');
	const mapRect = mapPanel?.getBoundingClientRect();
	if (mapRect && detailRect.left >= mapRect.right - 1) {
		return;
	}
	const readableDetailTop = Math.min(128, window.innerHeight / 4);
	if (detailRect.top >= 0 && detailRect.top <= readableDetailTop) {
		return;
	}
	detail.scrollIntoView({ block: "start" });
}

function revealDiningReview(review: HTMLElement | null): void {
	if (!review) {
		return;
	}
	const reviewTop = review.getBoundingClientRect().top;
	const readableBottom = window.innerHeight - 160;
	if (reviewTop >= 0 && reviewTop <= readableBottom) {
		return;
	}
	review.scrollIntoView({
		behavior: window.matchMedia(REDUCED_MOTION_QUERY).matches ? "auto" : "smooth",
		block: "start",
	});
}
