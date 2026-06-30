import { Search } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
	DiningOfferingReviews,
	HallSelector,
	InteractiveFloorplan,
	StallDetail,
	TagFilters,
} from "@/components/dining/dining-experience";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { contentSwap } from "@/components/ui/motion";
import { SurfaceState } from "@/components/ui/surface-state";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getDiningFloor, getDiningHallReviews, getDiningHalls } from "@/features/dining/api";
import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningOfferingProjection,
	DiningReview,
	DiningWindowProjection,
} from "@/features/dining/model";
import { cn } from "@/lib/utils";

const ALL_CAMPUSES_VALUE = "all-campuses";

export function DiningPage() {
	const [halls, setHalls] = useState<DiningHallSummary[]>([]);
	const [selectedCampus, setSelectedCampus] = useState("");
	const [selectedHallId, setSelectedHallId] = useState("");
	const [selectedFloorId, setSelectedFloorId] = useState("");
	const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);
	const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [floor, setFloor] = useState<DiningFloorResponse | null>(null);
	const [reviews, setReviews] = useState<DiningReview[]>([]);
	const [hallsError, setHallsError] = useState<string | null>(null);
	const [floorError, setFloorError] = useState<string | null>(null);
	const [reviewsError, setReviewsError] = useState<string | null>(null);
	const [isLoadingHalls, setIsLoadingHalls] = useState(true);
	const detailRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		getDiningHalls()
			.then((payload) => {
				setHallsError(null);
				setHalls(payload.halls);
				const firstHall = payload.halls[0];
				if (firstHall) {
					setSelectedHallId(firstHall.hallId);
					setSelectedFloorId(firstHall.floors[0]?.floorId ?? "");
				}
			})
			.catch(() => {
				setHallsError("食堂信息暂时无法读取。");
			})
			.finally(() => {
				setIsLoadingHalls(false);
			});
	}, []);

	useEffect(() => {
		if (!(selectedHallId && selectedFloorId)) {
			setFloor(null);
			setFloorError(null);
			setReviews([]);
			return;
		}
		getDiningFloor({ floorId: selectedFloorId, hallId: selectedHallId })
			.then((payload) => {
				setFloor(payload);
				setFloorError(null);
				setSelectedWindowId(payload.windows[0]?.windowId ?? null);
				setSelectedOfferingId(null);
				setSelectedTag(null);
			})
			.catch(() => {
				setFloor(null);
				setFloorError("食堂平面图暂时无法打开。");
			});
	}, [selectedHallId, selectedFloorId]);

	useEffect(() => {
		if (!selectedHallId) {
			setReviews([]);
			return;
		}
		getDiningHallReviews({ hallId: selectedHallId })
			.then((payload) => {
				setReviews(payload.reviews);
				setReviewsError(null);
			})
			.catch(() => {
				setReviews([]);
				setReviewsError("食堂评价暂时无法读取。");
			});
	}, [selectedHallId]);

	const campuses = useMemo(() => uniqueStrings(halls.map((hall) => hall.campus)), [halls]);
	const selectedHall = halls.find((hall) => hall.hallId === selectedHallId) ?? null;
	const campusHalls = halls.filter((hall) => !selectedCampus || hall.campus === selectedCampus);
	const filteredWindows = useMemo(
		() =>
			(floor?.windows ?? []).filter(
				(window) =>
					windowMatchesQuery(window, query) && (!selectedTag || window.tags.includes(selectedTag)),
			),
		[floor, query, selectedTag],
	);
	const matchedWindowIds = useMemo(
		() =>
			hasActiveWindowFilter(query, selectedTag)
				? new Set(filteredWindows.map((window) => window.windowId))
				: null,
		[filteredWindows, query, selectedTag],
	);
	const selectedWindow =
		filteredWindows.find((window) => window.windowId === selectedWindowId) ??
		filteredWindows[0] ??
		null;
	const selectedOfferings = selectedWindow?.assignment?.offerings ?? [];
	const selectedStallName = selectedWindow
		? (selectedWindow.assignment?.stallProfile.displayName ?? selectedWindow.label)
		: null;
	const selectedStallReviews = selectedStallName
		? reviews.filter((review) => review.stallName === selectedStallName)
		: [];
	const defaultOffering = resolveDefaultDiningOffering({
		offerings: selectedOfferings,
		reviews: selectedStallReviews,
	});
	const selectedOffering =
		selectedOfferings.find((offering) => offering.offeringId === selectedOfferingId) ??
		defaultOffering;
	const selectedOfferingReviews = selectedOffering
		? selectedStallReviews.filter((review) => review.dishName === selectedOffering.name)
		: [];
	const selectedHallMatchesLoadedFloor =
		query.trim().length > 0 &&
		selectedHall !== null &&
		floor?.floor.hallId === selectedHall.hallId &&
		filteredWindows.length > 0;
	const filteredHalls = campusHalls.filter(
		(hall) =>
			hallMatchesQuery(hall, query) ||
			(hall.hallId === selectedHall?.hallId && selectedHallMatchesLoadedFloor),
	);
	const hasQuery = query.trim().length > 0;
	const hasSearchResults = !hasQuery || filteredHalls.length > 0 || filteredWindows.length > 0;

	function selectHall(hall: DiningHallSummary, campusFilter = selectedCampus) {
		setSelectedCampus(campusFilter);
		setSelectedHallId(hall.hallId);
		setSelectedFloorId(hall.floors[0]?.floorId ?? "");
	}

	function selectWindow(windowId: string, options: { scrollDetail?: boolean } = {}) {
		setSelectedWindowId(windowId);
		setSelectedOfferingId(null);
		if (!(options.scrollDetail && isMobileDiningViewport())) {
			return;
		}
		window.requestAnimationFrame(() => {
			detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}

	function clearFilters() {
		setQuery("");
		setSelectedTag(null);
	}

	return (
		<section className="mx-auto max-w-[1440px] px-5 py-6 pb-24 lg:px-6">
			<div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="mt-1 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
						食堂
					</h1>
				</div>
				{hallsError ? null : (
					<div className="grid gap-3 sm:grid-cols-[minmax(240px,320px)_auto]">
						<label className="relative block" htmlFor="dining-search">
							<Search
								aria-hidden="true"
								className="-translate-y-1/2 pointer-events-none absolute left-3 top-1/2 size-4 text-[var(--sys-text-subtle)]"
							/>
							<Input
								aria-label="搜索食堂、档口、菜品"
								className="pl-9"
								id="dining-search"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="搜索食堂、档口、菜品"
								value={query}
							/>
						</label>
						<ToggleGroup
							aria-label="校区"
							onValueChange={(value) => {
								if (!value) {
									return;
								}
								const nextCampus = value === ALL_CAMPUSES_VALUE ? "" : value;
								const hall = halls.find((item) => !nextCampus || item.campus === nextCampus);
								if (hall) {
									selectHall(hall, nextCampus);
								}
							}}
							type="single"
							value={selectedCampus || ALL_CAMPUSES_VALUE}
						>
							<ToggleGroupItem
								className={cn(
									"min-h-11 rounded-lg px-4 text-[var(--sys-text-muted)]",
									selectedCampus === "" &&
										"border-[var(--sys-text-strong)] bg-[var(--sys-text-strong)] text-white",
								)}
								value={ALL_CAMPUSES_VALUE}
							>
								全部校区
							</ToggleGroupItem>
							{campuses.map((campus) => (
								<ToggleGroupItem
									className={cn(
										"min-h-11 rounded-lg px-4 text-[var(--sys-text-muted)]",
										selectedCampus === campus &&
											"border-[var(--sys-text-strong)] bg-[var(--sys-text-strong)] text-white",
									)}
									key={campus}
									value={campus}
								>
									{campus}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
				)}
			</div>

			{hallsError ? (
				<SurfaceState
					description={hallsError}
					kind="error"
					primaryAction={
						<Button onClick={() => window.location.reload()} type="button">
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
			{floorError ? <Alert variant="destructive">{floorError}</Alert> : null}
			{reviewsError ? <Alert variant="destructive">{reviewsError}</Alert> : null}
			{isLoadingHalls && !hallsError ? (
				<SurfaceState
					description="正在读取已发布的食堂、楼层和窗口数据。"
					kind="loading"
					title="正在读取食堂数据"
				/>
			) : null}
			{!isLoadingHalls && halls.length === 0 && !hallsError ? (
				<SurfaceState
					className="border-dashed text-center"
					description="当前没有已发布的食堂数据。"
					kind="empty"
					title="暂无内容"
				/>
			) : null}
			{halls.length > 0 ? (
				<LayoutGroup>
					<motion.div className="space-y-5" layout>
						{hasSearchResults ? (
							<motion.div key="hall-selector" layout {...contentSwap}>
								<HallSelector
									halls={filteredHalls}
									onSelectHall={selectHall}
									selectedHallId={selectedHallId}
								/>
							</motion.div>
						) : null}
						{hasSearchResults ? (
							floor && selectedHall ? (
								<motion.div
									className="space-y-4"
									key={`${floor.floor.hallId}:${floor.floor.floorId}`}
									layout
									{...contentSwap}
								>
									<div
										className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"
										data-testid="dining-selection-panel"
									>
										<Card className="overflow-hidden p-4" data-testid="dining-map-panel">
											<div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
												<div>
													<p className="text-sm font-semibold text-[var(--sys-text-strong)]">
														{floor.floor.label}
													</p>
													<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
														{floor.source.label} ·{" "}
														{new Date(floor.source.updatedAt).toLocaleDateString("zh-CN")}
													</p>
												</div>
												<ToggleGroup
													aria-label="楼层"
													onValueChange={(floorId) => {
														if (floorId) {
															setSelectedFloorId(floorId);
														}
													}}
													type="single"
													value={selectedFloorId}
												>
													{selectedHall.floors.map((item) => (
														<ToggleGroupItem
															className={cn(
																"min-h-9 text-[var(--sys-text-muted)]",
																selectedFloorId === item.floorId &&
																	"border-primary bg-[var(--sys-brand-interactive-subtle)] text-primary",
															)}
															key={item.floorId}
															value={item.floorId}
														>
															{item.label}
														</ToggleGroupItem>
													))}
												</ToggleGroup>
											</div>
											<TagFilters
												onSelectTag={setSelectedTag}
												selectedTag={selectedTag}
												tags={floor.filters.tags}
											/>
											<div className="mt-4">
												<InteractiveFloorplan
													floor={floor}
													matchedWindowIds={matchedWindowIds}
													onSelectWindow={(windowId) =>
														selectWindow(windowId, { scrollDetail: true })
													}
													selectedWindowId={selectedWindow?.windowId ?? selectedWindowId}
													windows={floor.windows}
												/>
											</div>
										</Card>
										<div
											className="scroll-mt-3 space-y-4 xl:col-start-2 xl:row-start-1"
											ref={detailRef}
										>
											<StallDetail
												onSelectOffering={setSelectedOfferingId}
												selectedOfferingId={selectedOffering?.offeringId ?? null}
												window={selectedWindow}
											/>
										</div>
									</div>
									<DiningOfferingReviews
										label={selectedOffering ? `${selectedOffering.name}评价` : "菜品评价"}
										reviews={selectedOfferingReviews}
									/>
								</motion.div>
							) : (
								<motion.div key="empty-floor" layout {...contentSwap}>
									<Card className="flex min-h-32 flex-col items-center justify-center border-dashed px-6 py-8 text-center">
										<h3 className="font-medium text-foreground text-sm">暂无内容</h3>
										<p className="mt-1 max-w-sm text-muted-foreground text-sm">
											当前没有已发布的食堂楼层数据。
										</p>
									</Card>
								</motion.div>
							)
						) : (
							<motion.div key="empty-search" layout {...contentSwap}>
								<SurfaceState
									description="调整搜索词或筛选条件后再试。"
									kind="empty"
									primaryAction={
										<Button onClick={clearFilters} type="button" variant="outline">
											清除筛选
										</Button>
									}
									title="没有匹配的食堂、档口或菜品"
								/>
							</motion.div>
						)}
					</motion.div>
				</LayoutGroup>
			) : null}
		</section>
	);
}

function resolveDefaultDiningOffering(input: {
	offerings: DiningOfferingProjection[];
	reviews: DiningReview[];
}): DiningOfferingProjection | null {
	return (
		input.offerings.find((offering) =>
			input.reviews.some((review) => review.dishName === offering.name),
		) ??
		input.offerings[0] ??
		null
	);
}

function hasActiveWindowFilter(query: string, selectedTag: string | null): boolean {
	return query.trim().length > 0 || selectedTag !== null;
}

function isMobileDiningViewport(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(max-width: 767px)").matches
	);
}

function hallMatchesQuery(hall: DiningHallSummary, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return true;
	}
	return [hall.name, hall.campus].some((value) => value.toLowerCase().includes(normalized));
}

function windowMatchesQuery(window: DiningWindowProjection, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return true;
	}
	const values = [
		window.label,
		window.locationLabel,
		...(window.assignment ? [window.assignment.stallProfile.displayName] : []),
		...window.tags,
		...(window.assignment?.offerings.flatMap((offering) => [
			offering.name,
			offering.priceLabel,
			...offering.tags,
		]) ?? []),
	];
	return values.some((value) => value.toLowerCase().includes(normalized));
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}
