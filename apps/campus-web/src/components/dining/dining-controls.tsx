import { LoaderCircle, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import type { DiningHallSummary, DiningSearchResult } from "@/features/dining/model";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function DiningHallSwitcher({
	halls,
	onPrefetchHall,
	onSelectHall,
	selectedHallId,
}: {
	halls: DiningHallSummary[];
	onPrefetchHall(hall: DiningHallSummary): void;
	onSelectHall(hall: DiningHallSummary): void;
	selectedHallId: string;
}) {
	const hallGroups = groupHallsByCampus(halls);
	return (
		<>
			<div className="hidden flex-wrap items-center gap-x-6 gap-y-3 lg:flex">
				{hallGroups.map(([campus, campusHalls]) => (
					<fieldset
						aria-label={campus}
						className="flex min-w-0 flex-wrap items-center gap-2"
						key={campus}
					>
						<span className="text-xs font-medium text-[var(--sys-text-subtle)]">{campus}</span>
						<div className="flex items-center gap-1 rounded-lg bg-surface-muted/60 p-1">
							{campusHalls.map((hall) => {
								const isSelected = selectedHallId === hall.hallId;
								return (
									<Button
										aria-pressed={isSelected}
										className={cn(
											"min-h-9 rounded-md px-3 shadow-none",
											isSelected
												? "bg-background text-primary shadow-sm hover:bg-background"
												: "text-[var(--sys-text-muted)] hover:bg-background/70 hover:text-[var(--sys-text-strong)]",
										)}
										key={hall.hallId}
										onClick={() => onSelectHall(hall)}
										onFocus={() => onPrefetchHall(hall)}
										onPointerEnter={() => onPrefetchHall(hall)}
										type="button"
										variant="ghost"
									>
										{hall.name}
									</Button>
								);
							})}
						</div>
					</fieldset>
				))}
			</div>
			<div className="lg:hidden">
				<label className="sr-only" htmlFor="dining-hall-switcher">
					选择食堂
				</label>
				<Select
					onValueChange={(hallId) => {
						const hall = halls.find((item) => item.hallId === hallId);
						if (hall) {
							onSelectHall(hall);
						}
					}}
					value={selectedHallId}
				>
					<SelectTrigger
						className="h-11 rounded-lg bg-background shadow-none"
						id="dining-hall-switcher"
					>
						<SelectValue placeholder="选择食堂" />
					</SelectTrigger>
					<SelectContent align="start">
						{hallGroups.map(([campus, campusHalls]) => (
							<SelectGroup key={campus}>
								<SelectLabel className="text-xs text-[var(--sys-text-subtle)]">
									{campus}
								</SelectLabel>
								{campusHalls.map((hall) => (
									<SelectItem
										className="min-h-10"
										key={hall.hallId}
										onFocus={() => onPrefetchHall(hall)}
										onPointerMove={() => onPrefetchHall(hall)}
										value={hall.hallId}
									>
										{hall.name}
									</SelectItem>
								))}
							</SelectGroup>
						))}
					</SelectContent>
				</Select>
			</div>
		</>
	);
}

export function DiningMapToolbar({
	campus,
	floorLabel,
	floors,
	hasActiveSearch,
	onClearFilters,
	onPrefetchFloor,
	onPrefetchResult,
	onQueryChange,
	onRetrySearch,
	onSelectFloor,
	onSelectResult,
	onSelectTag,
	query,
	searchError,
	searchIsLoading,
	searchResults,
	searchTotal,
	selectedFloorId,
	selectedTag,
	tags,
}: {
	campus: string;
	floorLabel: string;
	floors: DiningHallSummary["floors"];
	hasActiveSearch: boolean;
	onClearFilters(): void;
	onPrefetchFloor(floorId: string): void;
	onPrefetchResult(result: DiningSearchResult): void;
	onQueryChange(query: string): void;
	onRetrySearch(): void;
	onSelectFloor(floorId: string): void;
	onSelectResult(result: DiningSearchResult): void;
	onSelectTag(tag: string | null): void;
	query: string;
	searchError: string | null;
	searchIsLoading: boolean;
	searchResults: DiningSearchResult[];
	searchTotal: number;
	selectedFloorId: string;
	selectedTag: string | null;
	tags: string[];
}) {
	const [isFilterOpen, setIsFilterOpen] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const showSearchResults = hasActiveSearch && isSearchOpen;
	return (
		<div className="border-border/70 border-b px-3 py-3 sm:px-4">
			<h2 className="sr-only">{floorLabel}</h2>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				{floors.length > 1 ? (
					<ToggleGroup
						aria-label="楼层"
						className="w-fit shrink-0 rounded-lg bg-surface-muted/70 p-1"
						onValueChange={(floorId) => {
							if (floorId) {
								onSelectFloor(floorId);
							}
						}}
						type="single"
						value={selectedFloorId}
						variant="default"
					>
						{floors.map((floor) => (
							<ToggleGroupItem
								className="min-h-9 rounded-md px-3 shadow-none data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm"
								key={floor.floorId}
								onFocus={() => onPrefetchFloor(floor.floorId)}
								onPointerEnter={() => onPrefetchFloor(floor.floorId)}
								value={floor.floorId}
							>
								{floor.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				) : null}
				<div className="flex min-w-0 flex-1 gap-2">
					<Command
						className="h-auto min-w-0 flex-1 overflow-visible rounded-none bg-transparent [&_[cmdk-input-wrapper]]:min-w-0 [&_[cmdk-input-wrapper]]:flex-1 [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:px-3"
						label={`搜索${campus}的档口或菜品`}
						shouldFilter={false}
					>
						<Popover onOpenChange={setIsSearchOpen} open={showSearchResults}>
							<PopoverAnchor asChild>
								<div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:ring-1 focus-within:ring-ring">
									<CommandInput
										aria-expanded={showSearchResults}
										aria-haspopup="listbox"
										className="h-11 py-0"
										id="dining-search"
										onFocus={() => hasActiveSearch && setIsSearchOpen(true)}
										onValueChange={(value) => {
											onQueryChange(value);
											setIsSearchOpen(true);
										}}
										placeholder="搜索菜品或档口"
										value={query}
									/>
									{query ? (
										<Button
											aria-label="清除搜索"
											className="shrink-0 rounded-none text-[var(--sys-text-subtle)] shadow-none hover:text-[var(--sys-text-strong)]"
											onClick={() => {
												onQueryChange("");
												setIsSearchOpen(false);
											}}
											size="icon-lg"
											type="button"
											variant="ghost"
										>
											<X aria-hidden="true" />
										</Button>
									) : null}
									{tags.length > 0 ? (
										<Popover onOpenChange={setIsFilterOpen} open={isFilterOpen}>
											<PopoverTrigger asChild>
												<Button
													aria-label={selectedTag ? `筛选：${selectedTag}` : "筛选餐饮标签"}
													className={cn(
														"h-11 min-w-11 max-w-28 shrink-0 rounded-none border-border/70 border-l px-3 shadow-none focus-visible:ring-0",
														selectedTag &&
															"border-primary/40 bg-[var(--sys-brand-interactive-subtle)] text-primary",
													)}
													data-testid="dining-filter-trigger"
													type="button"
													variant="ghost"
												>
													<SlidersHorizontal aria-hidden="true" />
													<span className={cn("truncate", !selectedTag && "hidden sm:inline")}>
														{selectedTag ?? "筛选"}
													</span>
												</Button>
											</PopoverTrigger>
											<PopoverContent align="end" className="w-56 p-2">
												<p className="px-2 pb-2 pt-1 text-xs font-medium text-[var(--sys-text-subtle)]">
													餐饮标签
												</p>
												<ToggleGroup
													aria-label="餐饮标签"
													className="flex-col items-stretch"
													onValueChange={(value) => {
														onSelectTag(value && value !== "all" ? value : null);
														setIsFilterOpen(false);
														setIsSearchOpen(value !== "all");
													}}
													type="single"
													value={selectedTag ?? "all"}
												>
													<ToggleGroupItem
														className="min-h-10 w-full justify-start px-3"
														value="all"
													>
														全部
													</ToggleGroupItem>
													{tags.map((tag) => (
														<ToggleGroupItem
															className="min-h-10 w-full justify-start px-3"
															key={tag}
															value={tag}
														>
															{tag}
														</ToggleGroupItem>
													))}
												</ToggleGroup>
											</PopoverContent>
										</Popover>
									) : null}
								</div>
							</PopoverAnchor>
							<PopoverContent
								align="end"
								className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:w-[420px]"
								onOpenAutoFocus={(event) => event.preventDefault()}
							>
								<DiningSearchResults
									error={searchError}
									isLoading={searchIsLoading}
									onPrefetchResult={onPrefetchResult}
									onRetry={onRetrySearch}
									onSelectResult={(result) => {
										onSelectResult(result);
										setIsSearchOpen(false);
									}}
									results={searchResults}
									total={searchTotal}
								/>
							</PopoverContent>
						</Popover>
					</Command>
				</div>
			</div>
			{hasActiveSearch ? (
				<div className="mt-2 flex min-h-8 items-center justify-between gap-3 text-xs text-[var(--sys-text-muted)]">
					<span aria-live="polite">
						{searchIsLoading ? "正在搜索" : searchError ? searchError : `${searchTotal} 个结果`}
					</span>
					<Button className="h-8 px-2" onClick={onClearFilters} type="button" variant="ghost">
						清除
					</Button>
				</div>
			) : null}
		</div>
	);
}

function DiningSearchResults({
	error,
	isLoading,
	onPrefetchResult,
	onRetry,
	onSelectResult,
	results,
	total,
}: {
	error: string | null;
	isLoading: boolean;
	onPrefetchResult(result: DiningSearchResult): void;
	onRetry(): void;
	onSelectResult(result: DiningSearchResult): void;
	results: DiningSearchResult[];
	total: number;
}) {
	return (
		<CommandList className="max-h-[min(50dvh,360px)]" label="搜索结果">
			{isLoading ? (
				<div className="flex min-h-24 items-center justify-center gap-2 text-sm text-[var(--sys-text-muted)]">
					<LoaderCircle
						aria-hidden="true"
						className="size-4 animate-spin motion-reduce:animate-none"
					/>
					正在搜索
				</div>
			) : error ? (
				<div className="flex min-h-24 flex-col items-center justify-center gap-2 px-4 text-sm text-destructive">
					<span>{error}</span>
					<Button onClick={onRetry} size="sm" type="button" variant="outline">
						重试
					</Button>
				</div>
			) : results.length === 0 ? (
				<CommandEmpty>当前校区没有匹配结果</CommandEmpty>
			) : (
				<>
					<div className="border-border/70 border-b px-3 py-2 text-xs text-[var(--sys-text-subtle)]">
						{total} 个结果
					</div>
					{results.map((result) => (
						<CommandItem
							className="min-h-14 items-start rounded-none border-border/60 border-b px-3 py-2.5 last:border-b-0"
							key={result.resultId}
							onFocus={() => onPrefetchResult(result)}
							onPointerMove={() => onPrefetchResult(result)}
							onSelect={() => onSelectResult(result)}
							value={result.resultId}
						>
							<div className="min-w-0 flex-1">
								<p className="break-words text-sm font-medium text-[var(--sys-text-strong)]">
									{result.offering?.name ?? result.stallName}
								</p>
								<p className="mt-0.5 break-words text-xs text-[var(--sys-text-muted)]">
									{result.offering ? `${result.stallName} · ` : ""}
									{result.hallName}
									{result.floorLabel === "地图" ? "" : ` · ${result.floorLabel}`}
								</p>
							</div>
							{result.offering?.priceLabel ? (
								<span className="shrink-0 text-primary text-sm font-semibold">
									{result.offering.priceLabel}
								</span>
							) : null}
						</CommandItem>
					))}
				</>
			)}
		</CommandList>
	);
}

function groupHallsByCampus(halls: DiningHallSummary[]): [string, DiningHallSummary[]][] {
	const groups = new Map<string, DiningHallSummary[]>();
	for (const hall of halls) {
		const campusHalls = groups.get(hall.campus) ?? [];
		campusHalls.push(hall);
		groups.set(hall.campus, campusHalls);
	}
	return [...groups];
}
