import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
	HallSelector,
	InteractiveFloorplan,
	StallDetail,
	TagFilters,
} from "@/components/dining/dining-experience";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getDiningFloor, getDiningHallReviews, getDiningHalls } from "@/features/dining/api";
import type {
	DiningFloorResponse,
	DiningHallSummary,
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
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [floor, setFloor] = useState<DiningFloorResponse | null>(null);
	const [reviews, setReviews] = useState<DiningReview[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isLoadingHalls, setIsLoadingHalls] = useState(true);
	const detailRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		getDiningHalls()
			.then((payload) => {
				setHalls(payload.halls);
				const firstHall = payload.halls[0];
				if (firstHall) {
					setSelectedHallId(firstHall.hallId);
					setSelectedFloorId(firstHall.floors[0]?.floorId ?? "");
				}
			})
			.catch(() => {
				setError("食堂信息暂时无法读取。");
			})
			.finally(() => {
				setIsLoadingHalls(false);
			});
	}, []);

	useEffect(() => {
		if (!(selectedHallId && selectedFloorId)) {
			setFloor(null);
			setReviews([]);
			return;
		}
		getDiningFloor({ floorId: selectedFloorId, hallId: selectedHallId })
			.then((payload) => {
				setFloor(payload);
				setSelectedWindowId(payload.windows[0]?.windowId ?? null);
				setSelectedTag(null);
				setError(null);
			})
			.catch(() => {
				setFloor(null);
				setError("食堂平面图暂时无法打开。");
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
			})
			.catch(() => {
				setReviews([]);
				setError("食堂评价暂时无法读取。");
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
		if (!(options.scrollDetail && isMobileDiningViewport())) {
			return;
		}
		window.requestAnimationFrame(() => {
			detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}

	return (
		<section className="mx-auto max-w-[1440px] px-5 py-6 pb-24 lg:px-6">
			<div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="mt-1 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
						食堂
					</h1>
				</div>
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
			</div>

			{error ? <Alert variant="destructive">{error}</Alert> : null}
			{isLoadingHalls && !error ? (
				<div className="rounded-lg border border-border bg-card p-6" role="status">
					<Skeleton className="h-4 w-32" />
					<span className="sr-only">正在读取食堂数据</span>
				</div>
			) : null}
			{!isLoadingHalls && halls.length === 0 && !error ? (
				<Card className="flex min-h-32 flex-col items-center justify-center border-dashed px-6 py-8 text-center">
					<h3 className="font-medium text-foreground text-sm">暂无内容</h3>
					<p className="mt-1 max-w-sm text-muted-foreground text-sm">当前没有已发布的食堂数据。</p>
				</Card>
			) : null}
			{halls.length > 0 ? (
				<div className="space-y-5">
					{hasSearchResults ? (
						<HallSelector
							halls={filteredHalls}
							onSelectHall={selectHall}
							selectedHallId={selectedHallId}
						/>
					) : null}
					{hasSearchResults ? (
						floor && selectedHall ? (
							<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
								<Card className="overflow-hidden p-4">
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
									<div className="mt-4 grid gap-4">
										<InteractiveFloorplan
											floor={floor}
											matchedWindowIds={matchedWindowIds}
											onSelectWindow={(windowId) => selectWindow(windowId, { scrollDetail: true })}
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
										key={selectedWindow?.windowId ?? "empty"}
										reviews={reviews}
										window={selectedWindow}
									/>
								</div>
							</div>
						) : (
							<Card className="flex min-h-32 flex-col items-center justify-center border-dashed px-6 py-8 text-center">
								<h3 className="font-medium text-foreground text-sm">暂无内容</h3>
								<p className="mt-1 max-w-sm text-muted-foreground text-sm">
									当前没有已发布的食堂楼层数据。
								</p>
							</Card>
						)
					) : (
						<Card className="flex min-h-32 flex-col items-center justify-center border-dashed px-6 py-8 text-center">
							<h3 className="font-medium text-foreground text-sm">没有匹配的食堂、档口或菜品</h3>
							<p className="mt-1 max-w-sm text-muted-foreground text-sm">
								调整搜索词或筛选条件后再试。
							</p>
						</Card>
					)}
				</div>
			) : null}
		</section>
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
