import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
	HallGrid,
	InteractiveFloorplan,
	TagFilters,
	WindowDetail,
	WindowList,
} from "@/components/dining/dining-experience";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getDiningFloor, getDiningHalls } from "@/features/dining/api";
import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningWindowProjection,
} from "@/features/dining/model";
import { cn } from "@/lib/utils";

export function DiningPage() {
	const [halls, setHalls] = useState<DiningHallSummary[]>([]);
	const [selectedCampus, setSelectedCampus] = useState("");
	const [selectedHallId, setSelectedHallId] = useState("");
	const [selectedFloorId, setSelectedFloorId] = useState("");
	const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [floor, setFloor] = useState<DiningFloorResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoadingHalls, setIsLoadingHalls] = useState(true);

	useEffect(() => {
		getDiningHalls()
			.then((payload) => {
				setHalls(payload.halls);
				const firstHall = payload.halls[0];
				if (firstHall) {
					setSelectedCampus(firstHall.campus);
					setSelectedHallId(firstHall.hallId);
					setSelectedFloorId(firstHall.floors[0]?.floorId ?? "");
				}
			})
			.catch(() => {
				setError("饭堂信息暂时无法读取。");
			})
			.finally(() => {
				setIsLoadingHalls(false);
			});
	}, []);

	useEffect(() => {
		if (!(selectedHallId && selectedFloorId)) {
			setFloor(null);
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
				setError("饭堂平面图暂时无法打开。");
			});
	}, [selectedHallId, selectedFloorId]);

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

	function selectHall(hall: DiningHallSummary) {
		setSelectedCampus(hall.campus);
		setSelectedHallId(hall.hallId);
		setSelectedFloorId(hall.floors[0]?.floorId ?? "");
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
							aria-label="搜索食堂、餐饮点、菜品"
							className="pl-9"
							id="dining-search"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="搜索食堂、餐饮点、菜品"
							value={query}
						/>
					</label>
					<ToggleGroup
						aria-label="校区"
						onValueChange={(campus) => {
							if (!campus) {
								return;
							}
							setSelectedCampus(campus);
							const hall = halls.find((item) => item.campus === campus);
							if (hall) {
								selectHall(hall);
							}
						}}
						type="single"
						value={selectedCampus}
					>
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

			{error ? <ErrorPanel message={error} /> : null}
			{isLoadingHalls && !error ? <LoadingPanel label="正在读取食堂数据" /> : null}
			{!isLoadingHalls && halls.length === 0 && !error ? (
				<EmptyPanel message="当前没有已发布的食堂数据。" />
			) : null}
			{halls.length > 0 ? (
				<div className="space-y-5">
					<HallGrid
						halls={filteredHalls}
						onSelectHall={selectHall}
						selectedHallId={selectedHallId}
					/>
					{floor && selectedHall ? (
						<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
							<Card className="overflow-hidden p-4">
								<div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
									<div>
										<p className="text-sm font-semibold text-[var(--sys-text-strong)]">
											{floor.floor.label}
										</p>
										<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
											{floor.source.label} · {floor.source.releaseId} ·{" "}
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
								<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
									<InteractiveFloorplan
										floor={floor}
										onSelectWindow={setSelectedWindowId}
										selectedWindowId={selectedWindow?.windowId ?? selectedWindowId}
										windows={filteredWindows}
									/>
									<WindowList
										onSelectWindow={setSelectedWindowId}
										selectedWindowId={selectedWindow?.windowId ?? null}
										windows={filteredWindows}
									/>
								</div>
							</Card>
							<WindowDetail window={selectedWindow} />
						</div>
					) : (
						<EmptyPanel message="当前没有已发布的食堂楼层数据。" />
					)}
				</div>
			) : null}
		</section>
	);
}

function hallMatchesQuery(hall: DiningHallSummary, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return true;
	}
	return [hall.name, hall.campus, ...hall.tags].some((value) =>
		value.toLowerCase().includes(normalized),
	);
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
