import { Button, cn, Input } from "@campus-agent/ui";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { contentSwap, panelPresence } from "@/components/ui/motion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { MapPlaceView, MapTaskFilter } from "@/features/map/view-model";
import { PlaceList } from "./map-place-list";

export function MapSearchPanel({
	campuses,
	categories,
	category,
	campus,
	campusNotice,
	compactResults,
	isDesktop,
	listExpanded,
	onCategoryChange,
	onClearFilters,
	onCampusChange,
	onClearSelection,
	onListExpandedChange,
	onPlaceSelect,
	onQueryChange,
	places,
	query,
	selectedPlaceId,
}: {
	campuses: string[];
	categories: Array<{ label: string; value: Exclude<MapTaskFilter, "all"> }>;
	category: MapTaskFilter;
	campus: string;
	campusNotice: string | null;
	compactResults: boolean;
	isDesktop: boolean;
	listExpanded: boolean;
	onCategoryChange: (category: MapTaskFilter) => void;
	onClearFilters: () => void;
	onCampusChange: (campus: string) => void;
	onClearSelection: () => void;
	onListExpandedChange: (expanded: boolean) => void;
	onPlaceSelect: (placeId: string) => void;
	onQueryChange: (query: string) => void;
	places: MapPlaceView[];
	query: string;
	selectedPlaceId: string | null;
}) {
	const hasQuery = query.trim().length > 0;
	const [activeResultState, setActiveResultState] = useState({ index: -1, key: "" });
	const resultStateKey = [
		campus,
		category,
		query,
		places.map((place) => place.place.id).join("|"),
	].join("\u0000");
	const activeResultIndex = activeResultState.key === resultStateKey ? activeResultState.index : -1;

	return (
		<motion.aside
			aria-label="地点搜索与结果"
			className={cn(
				"pointer-events-auto absolute z-[var(--layer-domain)] rounded-2xl border-2 border-[var(--map-overlay-border-strong)] bg-[var(--map-overlay-surface-strong)] shadow-[var(--map-overlay-shadow-strong)] backdrop-blur-md",
				isDesktop
					? "left-3 top-3 flex w-[min(360px,calc(100vw-1.5rem))] flex-col"
					: "inset-x-3 top-3 flex flex-col overflow-hidden",
				listExpanded && !compactResults
					? isDesktop
						? "max-h-[min(58dvh,430px)]"
						: "max-h-[42dvh]"
					: isDesktop
						? "max-h-[min(34dvh,220px)]"
						: "max-h-[148px]",
			)}
			layout
		>
			<LayoutGroup>
				<div className="min-h-0 bg-transparent">
					<motion.div
						className={cn(
							"space-y-2 p-2.5",
							listExpanded && "border-b border-[var(--map-overlay-divider)]",
						)}
						layout
					>
						<div className="flex items-center gap-2">
							<form
								aria-label="地点搜索"
								className="min-w-0 flex-1"
								onKeyDown={(event) => {
									if (event.key !== "Escape") {
										return;
									}
									if (selectedPlaceId) {
										event.preventDefault();
										onClearSelection();
										return;
									}
									if (hasQuery) {
										event.preventDefault();
										onQueryChange("");
									}
								}}
								onSubmit={(event) => event.preventDefault()}
							>
								<div className="relative flex items-center">
									<Search
										aria-hidden="true"
										className="pointer-events-none absolute left-3 z-10 size-4 text-[var(--sys-text-subtle)]"
									/>
									<Input
										aria-controls={
											listExpanded && !compactResults ? "campus-map-results" : undefined
										}
										aria-label="搜索地点"
										className={cn(
											"rounded-full border-2 border-[var(--map-overlay-border-strong)] bg-[var(--map-overlay-surface-strong)] pl-9 font-medium shadow-[var(--map-overlay-shadow)]",
											hasQuery ? "pr-10" : "pr-3",
											isDesktop ? "min-h-10" : "min-h-11",
										)}
										onFocus={() => onListExpandedChange(true)}
										onKeyDown={(event) => {
											if (event.key === "ArrowDown") {
												event.preventDefault();
												onListExpandedChange(true);
												setActiveResultState((current) => ({
													index: getNextPlaceIndex(
														current.key === resultStateKey ? current.index : -1,
														places.length,
														1,
													),
													key: resultStateKey,
												}));
												return;
											}
											if (event.key === "ArrowUp") {
												event.preventDefault();
												onListExpandedChange(true);
												setActiveResultState((current) => ({
													index: getNextPlaceIndex(
														current.key === resultStateKey ? current.index : -1,
														places.length,
														-1,
													),
													key: resultStateKey,
												}));
												return;
											}
											if (event.key === "Enter" && places.length > 0) {
												event.preventDefault();
												const place = places[activeResultIndex >= 0 ? activeResultIndex : 0];
												if (place) {
													onPlaceSelect(place.place.id);
												}
											}
										}}
										onChange={(event) => {
											onListExpandedChange(true);
											onQueryChange(event.currentTarget.value);
										}}
										name="q"
										placeholder="搜索地点"
										role="searchbox"
										type="text"
										value={query}
									/>
									{hasQuery ? (
										<Button
											aria-label="清除搜索"
											className="-translate-y-1/2 absolute right-1 top-1/2 rounded-full"
											onClick={() => {
												onQueryChange("");
												onListExpandedChange(true);
											}}
											size="icon"
											variant="ghost"
										>
											<X aria-hidden="true" className="size-4" />
										</Button>
									) : null}
								</div>
							</form>
							{compactResults ? null : (
								<Button
									aria-controls="campus-map-results"
									aria-expanded={listExpanded}
									aria-label={listExpanded ? "收起地点结果" : "展开地点结果"}
									className={cn(
										"shrink-0 gap-1 rounded-full border border-[var(--map-overlay-border)] font-semibold shadow-[var(--map-overlay-shadow)]",
										listExpanded
											? "bg-[var(--map-overlay-surface-soft)] text-[var(--map-overlay-muted)] hover:bg-[var(--map-overlay-surface-hover)] hover:text-[var(--map-overlay-text)]"
											: "bg-selected text-selected-foreground hover:bg-[var(--campus-selected-hover)]",
										isDesktop ? "min-h-10 text-xs" : "min-h-11 text-sm",
									)}
									onClick={() => onListExpandedChange(!listExpanded)}
									title={listExpanded ? "收起地点结果" : "展开地点结果"}
									variant="ghost"
								>
									{listExpanded ? (
										<ChevronUp aria-hidden="true" className="size-4" />
									) : (
										<ChevronDown aria-hidden="true" className="size-4" />
									)}
									<span>{listExpanded ? "收起" : "地点"}</span>
								</Button>
							)}
						</div>
						<CampusSelector
							campuses={campuses}
							campus={campus}
							isDesktop={isDesktop}
							onCampusChange={onCampusChange}
						/>
						{campusNotice ? <CampusReferenceNotice message={campusNotice} /> : null}
						{listExpanded && !compactResults ? (
							<motion.div key="category-filters" layout {...contentSwap}>
								<CategoryFilters
									categories={categories}
									category={category}
									isDesktop={isDesktop}
									onCategoryChange={onCategoryChange}
								/>
							</motion.div>
						) : null}
					</motion.div>
					{listExpanded && !compactResults ? (
						<motion.div
							className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
							id="campus-map-results"
							key="map-results"
							layout
							layoutScroll
							{...panelPresence}
						>
							<h2 className="ui-metadata px-2 py-1 font-semibold">地点</h2>
							<PlaceList
								activeResultIndex={activeResultIndex}
								forceExpanded={hasQuery || category !== "all"}
								onClearFilters={onClearFilters}
								onPlaceSelect={onPlaceSelect}
								places={places}
								selectedPlaceId={selectedPlaceId}
							/>
						</motion.div>
					) : null}
				</div>
			</LayoutGroup>
		</motion.aside>
	);
}

function CampusSelector({
	campuses,
	campus,
	isDesktop,
	onCampusChange,
}: {
	campuses: string[];
	campus: string;
	isDesktop: boolean;
	onCampusChange: (campus: string) => void;
}) {
	return (
		<ToggleGroup
			aria-label="选择校区"
			className="flex-nowrap overflow-x-auto pb-0.5"
			onValueChange={(value) => {
				if (value) {
					onCampusChange(value);
				}
			}}
			type="single"
			value={campus}
		>
			{campuses.map((item) => (
				<ToggleGroupItem
					className={cn(
						"shrink-0 rounded-full data-[state=on]:bg-selected data-[state=on]:text-selected-foreground",
						isDesktop ? "min-h-9" : "min-h-11",
					)}
					key={item}
					value={item}
				>
					{item}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

function CampusReferenceNotice({ message }: { message: string }) {
	return (
		<p className="rounded-xl border border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface-soft)] px-3 py-2 text-xs leading-5 text-[var(--map-overlay-muted)]">
			{message}
		</p>
	);
}

function CategoryFilters({
	categories,
	category,
	isDesktop,
	onCategoryChange,
}: {
	categories: Array<{ label: string; value: Exclude<MapTaskFilter, "all"> }>;
	category: MapTaskFilter;
	isDesktop: boolean;
	onCategoryChange: (category: MapTaskFilter) => void;
}) {
	return (
		<ToggleGroup
			aria-label="地点类型"
			className="flex-nowrap overflow-x-auto pb-0.5"
			onValueChange={(value) => {
				if (value) {
					onCategoryChange(value as MapTaskFilter);
				}
			}}
			type="single"
			value={category}
		>
			<ToggleGroupItem
				className={cn(
					"shrink-0 rounded-full data-[state=on]:bg-selected data-[state=on]:text-selected-foreground",
					isDesktop ? "min-h-9" : "min-h-11",
				)}
				value="all"
			>
				全部
			</ToggleGroupItem>
			{categories.map((item) => (
				<ToggleGroupItem
					className={cn(
						"shrink-0 rounded-full data-[state=on]:bg-selected data-[state=on]:text-selected-foreground",
						isDesktop ? "min-h-9" : "min-h-11",
					)}
					key={item.value}
					value={item.value}
				>
					{item.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

function getNextPlaceIndex(current: number, total: number, direction: 1 | -1) {
	if (total <= 0) {
		return -1;
	}
	const safeCurrent = current >= 0 ? current : direction > 0 ? -1 : 0;
	return (safeCurrent + direction + total) % total;
}
