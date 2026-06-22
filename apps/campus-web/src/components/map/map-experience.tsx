import { List, LocateFixed, MapPin, X } from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandInput } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	groupMapPlacesForDisplay,
	type MapPlaceView,
	type MapTaskFilter,
} from "@/features/map/view-model";
import { cn } from "@/lib/utils";

const DESKTOP_MAP_QUERY = "(min-width: 960px)";
const DEFAULT_VISIBLE_PLACES_PER_GROUP = 5;

export function MapExperience({
	assetAvailable,
	campuses,
	categories,
	category,
	campus,
	campusNotice,
	filteredPlaces,
	mapRef,
	onCanvasClick,
	onCategoryChange,
	onCampusChange,
	onPlaceSelect,
	onQueryChange,
	onResetViewport,
	query,
	selectedPlace,
	viewportControlsAvailable,
}: {
	assetAvailable: boolean;
	campuses: string[];
	categories: Array<{ label: string; value: Exclude<MapTaskFilter, "all"> }>;
	category: MapTaskFilter;
	campus: string;
	campusNotice: string | null;
	filteredPlaces: MapPlaceView[];
	mapRef: RefObject<HTMLElement | null>;
	onCanvasClick: () => void;
	onCategoryChange: (category: MapTaskFilter) => void;
	onCampusChange: (campus: string) => void;
	onPlaceSelect: (placeId: string) => void;
	onQueryChange: (query: string) => void;
	onResetViewport: () => void;
	query: string;
	selectedPlace: MapPlaceView | null;
	viewportControlsAvailable: boolean;
}) {
	const isDesktop = useIsDesktopMap();
	const [placeListExpanded, setPlaceListExpanded] = useState(
		() => query.trim().length > 0 || category !== "all",
	);

	return (
		<section
			aria-label="校园地图"
			className="relative min-h-dvh overflow-hidden bg-[var(--map-canvas-bg)]"
			data-surface="map-first"
		>
			<div className="absolute inset-0 bg-[var(--map-canvas-bg)]">
				<section aria-label="地图画布" className="h-full w-full" ref={mapRef} />
			</div>
			{assetAvailable ? null : <MapAssetNotice campus={campus} />}
			<MapProductNav />
			<MapSearchPanel
				campuses={campuses}
				categories={categories}
				category={category}
				campus={campus}
				campusNotice={campusNotice}
				compactResults={!isDesktop && Boolean(selectedPlace)}
				isDesktop={isDesktop}
				listExpanded={placeListExpanded}
				onCategoryChange={onCategoryChange}
				onCampusChange={onCampusChange}
				onClearSelection={onCanvasClick}
				onListExpandedChange={setPlaceListExpanded}
				onPlaceSelect={onPlaceSelect}
				onQueryChange={onQueryChange}
				places={filteredPlaces}
				query={query}
				selectedPlaceId={selectedPlace?.place.id ?? null}
			/>
			{viewportControlsAvailable && (isDesktop || !selectedPlace) ? (
				<MapViewportControls onResetViewport={onResetViewport} />
			) : null}
			{selectedPlace ? (
				<MapPlacePopover isDesktop={isDesktop} onClose={onCanvasClick} place={selectedPlace} />
			) : null}
		</section>
	);
}

function MapProductNav() {
	return (
		<nav
			aria-label="地图页面导航"
			className="pointer-events-auto absolute right-3 top-3 z-30 hidden rounded-full border border-white/65 bg-white/78 px-1.5 py-1 text-sm font-medium text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] backdrop-blur-md md:flex md:items-center"
		>
			<MapNavLink href="/">问答</MapNavLink>
			<MapNavLink href="/docs">文档</MapNavLink>
			<MapNavLink href="/dining">饭堂分布图</MapNavLink>
			<MapNavLink href="/feedback">反馈</MapNavLink>
		</nav>
	);
}

function MapNavLink({ children, href }: { children: string; href: string }) {
	return (
		<Button asChild className="min-h-8 rounded-full px-2.5 text-xs" size="sm" variant="ghost">
			<a href={href}>{children}</a>
		</Button>
	);
}

function MapSearchPanel({
	campuses,
	categories,
	category,
	campus,
	campusNotice,
	compactResults,
	isDesktop,
	listExpanded,
	onCategoryChange,
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
		<aside
			aria-label="地点搜索与结果"
			className={cn(
				"pointer-events-auto absolute z-30 rounded-2xl border border-white/70 bg-white/80 shadow-[var(--shadow-xs)] backdrop-blur-md",
				isDesktop
					? "left-3 top-3 flex w-[min(360px,calc(100vw-1.5rem))] flex-col"
					: "inset-x-3 top-3 overflow-hidden",
				listExpanded && !compactResults
					? isDesktop
						? "max-h-[min(58dvh,430px)]"
						: "max-h-[42dvh]"
					: isDesktop
						? "max-h-[min(34dvh,220px)]"
						: "max-h-[148px]",
			)}
		>
			<Command
				className="bg-transparent"
				filter={() => 1}
				label="搜索地点"
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
			>
				<div className={cn("space-y-2 p-2.5", listExpanded && "border-b border-white/60")}>
					<div className="flex items-center gap-2">
						<form
							aria-label="地点搜索"
							className="min-w-0 flex-1"
							onSubmit={(event) => event.preventDefault()}
						>
							<div className="relative">
								<CommandInput
									aria-label="搜索地点"
									className={cn(
										"rounded-full border border-white/70 bg-white/72 pl-1 shadow-[var(--shadow-xs)]",
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
									onValueChange={(value) => {
										onListExpandedChange(true);
										onQueryChange(value);
									}}
									placeholder="搜索地点"
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
										size="icon-sm"
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
									"rounded-full bg-white/58 text-[var(--sys-text-muted)] hover:bg-white/72 hover:text-[var(--sys-text-strong)]",
									isDesktop ? "min-h-10 text-xs" : "min-h-11 text-sm",
								)}
								onClick={() => onListExpandedChange(!listExpanded)}
								title={listExpanded ? "收起地点结果" : "展开地点结果"}
								variant="ghost"
							>
								<List aria-hidden="true" className="size-4" />
								<span className="hidden sm:inline">{listExpanded ? "收起" : "地点"}</span>
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
						<CategoryFilters
							categories={categories}
							category={category}
							isDesktop={isDesktop}
							onCategoryChange={onCategoryChange}
						/>
					) : null}
				</div>
				{listExpanded && !compactResults ? (
					<div className="min-h-0 flex-1 overflow-y-auto p-1.5" id="campus-map-results">
						<h2 className="px-2 py-1 text-[11px] font-semibold text-[var(--sys-text-subtle)]">
							地点
						</h2>
						<PlaceList
							activeResultIndex={activeResultIndex}
							forceExpanded={hasQuery || category !== "all"}
							onPlaceSelect={onPlaceSelect}
							places={places}
							selectedPlaceId={selectedPlaceId}
						/>
					</div>
				) : null}
			</Command>
		</aside>
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
					className={cn("shrink-0 rounded-full", isDesktop ? "min-h-9" : "min-h-11")}
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
		<p className="rounded-xl border border-white/65 bg-white/56 px-3 py-2 text-xs leading-5 text-[var(--sys-text-muted)]">
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
	onCategoryChange: (campus: MapTaskFilter) => void;
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
				className={cn("shrink-0 rounded-full", isDesktop ? "min-h-9" : "min-h-11")}
				value="all"
			>
				全部
			</ToggleGroupItem>
			{categories.map((item) => (
				<ToggleGroupItem
					className={cn("shrink-0 rounded-full", isDesktop ? "min-h-9" : "min-h-11")}
					key={item.value}
					value={item.value}
				>
					{item.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

function PlaceList({
	activeResultIndex,
	forceExpanded,
	onPlaceSelect,
	places,
	selectedPlaceId,
}: {
	activeResultIndex: number;
	forceExpanded: boolean;
	onPlaceSelect: (placeId: string) => void;
	places: MapPlaceView[];
	selectedPlaceId: string | null;
}) {
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
	if (places.length === 0) {
		return (
			<section aria-label="地点结果">
				<Empty className="border-transparent bg-transparent">
					<EmptyHeader>
						<EmptyTitle>没有找到匹配地点。</EmptyTitle>
						<EmptyDescription>调整搜索词或筛选条件后再试。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</section>
		);
	}

	const groups = groupMapPlacesForDisplay(places, { sortWithinGroups: true });
	let placeIndex = 0;

	return (
		<section aria-label="地点结果" className="space-y-3">
			{groups.map((group) => {
				const expanded = forceExpanded || expandedGroups.has(group.label);
				const visiblePlaces = expanded
					? group.places
					: group.places.slice(0, DEFAULT_VISIBLE_PLACES_PER_GROUP);
				const canToggle = group.places.length > DEFAULT_VISIBLE_PLACES_PER_GROUP;
				return (
					<fieldset className="space-y-1" key={group.label}>
						<legend className="px-2 text-[11px] font-semibold text-[var(--sys-text-subtle)]">
							{group.label}
						</legend>
						{visiblePlaces.map((place) => {
							const currentIndex = placeIndex;
							placeIndex += 1;
							const selected = selectedPlaceId === place.place.id;
							const active = activeResultIndex === currentIndex;
							return (
								<Button
									aria-label={`选择${place.place.title}`}
									aria-pressed={selected}
									className={cn(
										"flex w-full flex-col items-start rounded-lg border border-transparent bg-white/58 p-2.5 text-left whitespace-normal outline-none hover:bg-white/82 focus-visible:shadow-[var(--state-focus-shadow)]",
										active && "border-[var(--sys-border-default)] bg-white/78",
										selected && "border-[var(--sys-text-strong)] bg-white/88",
									)}
									key={place.place.id}
									onClick={() => onPlaceSelect(place.place.id)}
									variant="ghost"
								>
									<span className="block text-sm font-semibold text-[var(--sys-text-strong)]">
										{place.place.title}
									</span>
									<span className="mt-0.5 block text-[11px] text-[var(--sys-text-muted)]">
										{place.place.campus} · {place.categoryLabel}
									</span>
									<span className="mt-1 line-clamp-1 block text-xs leading-5 text-[var(--sys-text-muted)]">
										{place.place.description}
									</span>
								</Button>
							);
						})}
						{canToggle && !forceExpanded ? (
							<Button
								className="min-h-10 rounded-lg px-2 text-sm font-medium text-[var(--sys-text-muted)] outline-none hover:bg-white/72 hover:text-[var(--sys-text-strong)] focus-visible:shadow-[var(--state-focus-shadow)]"
								onClick={() =>
									setExpandedGroups((current) => {
										const next = new Set(current);
										if (next.has(group.label)) {
											next.delete(group.label);
										} else {
											next.add(group.label);
										}
										return next;
									})
								}
								variant="ghost"
							>
								{expanded ? `收起${group.label}` : `展开${group.label}`}
							</Button>
						) : null}
					</fieldset>
				);
			})}
		</section>
	);
}

function MapViewportControls({ onResetViewport }: { onResetViewport: () => void }) {
	return (
		<div className="pointer-events-auto absolute bottom-8 right-3 z-30 flex flex-col items-end gap-2">
			<Button
				aria-label="回到当前校区"
				className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/70 bg-white/82 px-3 text-sm font-medium text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] outline-none backdrop-blur-md hover:bg-white/92 hover:text-[var(--sys-text-strong)] focus-visible:shadow-[var(--state-focus-shadow)]"
				onClick={onResetViewport}
				variant="ghost"
			>
				<LocateFixed aria-hidden="true" className="size-4" />
				<span className="hidden sm:inline">当前校区</span>
			</Button>
		</div>
	);
}

function MapPlacePopover({
	isDesktop,
	onClose,
	place,
}: {
	isDesktop: boolean;
	onClose: () => void;
	place: MapPlaceView;
}) {
	function DetailCard({ titleKind = "heading" }: { titleKind?: "dialog" | "heading" }) {
		const title =
			titleKind === "dialog" ? (
				<DialogTitle className="truncate text-base font-semibold tracking-normal text-[var(--sys-text-strong)]">
					{place.place.title}
				</DialogTitle>
			) : (
				<h2 className="truncate text-base font-semibold tracking-normal text-[var(--sys-text-strong)]">
					{place.place.title}
				</h2>
			);
		return (
			<div className="flex items-start gap-3 p-4">
				<span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--sys-brand-interactive-subtle)] text-primary">
					<MapPin aria-hidden="true" className="size-5" />
				</span>
				<div className="min-w-0 flex-1">
					{title}
					<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
						{place.place.campus} · {place.categoryLabel}
					</p>
					<p className="mt-3 text-sm leading-6 text-[var(--sys-text-muted)]">
						{place.place.description}
					</p>
					<div className="mt-3 space-y-2">
						{place.detailRows.map((row) => (
							<div className="grid grid-cols-[64px_1fr] gap-3 text-sm" key={row.label}>
								<span className="text-[var(--sys-text-subtle)]">{row.label}</span>
								<span className="text-[var(--sys-text-muted)]">{row.value}</span>
							</div>
						))}
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						{place.displayTags.map((tag) => (
							<Badge key={tag} variant="muted">
								{tag}
							</Badge>
						))}
					</div>
				</div>
			</div>
		);
	}
	if (isDesktop) {
		return (
			<Popover open>
				<PopoverAnchor asChild>
					<div className="pointer-events-none absolute left-[384px] top-20 z-30 size-1" />
				</PopoverAnchor>
				<PopoverContent
					aria-label={place.place.title}
					className="pointer-events-auto z-30 w-[min(340px,calc(100vw-412px))] border-white/70 bg-white/86 p-0 shadow-[var(--shadow-sm)] backdrop-blur-md"
					data-variant="popover"
					onEscapeKeyDown={onClose}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<Button
						aria-label="关闭地点详情"
						className="absolute right-3 top-3 z-10"
						onClick={onClose}
						size="icon-lg"
						variant="ghost"
					>
						<X aria-hidden="true" className="size-4" />
					</Button>
					<DetailCard />
				</PopoverContent>
			</Popover>
		);
	}
	return (
		<Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
			<DialogContent
				aria-label={place.place.title}
				className="pointer-events-auto inset-x-3 bottom-3 top-auto left-auto max-h-[48dvh] w-auto translate-x-0 translate-y-0 overflow-y-auto rounded-2xl border-white/70 bg-white/86 p-0 pb-[max(0px,env(safe-area-inset-bottom))] shadow-[var(--shadow-sm)] backdrop-blur-md"
				data-variant="sheet"
				showCloseButton={false}
			>
				<Button
					aria-label="拖动关闭地点详情"
					className="mx-auto mt-2 grid min-h-5 w-16 place-items-center rounded-full text-[var(--sys-text-subtle)] outline-none focus-visible:shadow-[var(--state-focus-shadow)]"
					onClick={onClose}
					variant="ghost"
				>
					<span className="h-1 w-10 rounded-full bg-[var(--sys-border-default)]" />
				</Button>
				<div className="relative">
					<DetailCard titleKind="dialog" />
					<Button
						aria-label="关闭地点详情"
						className="absolute right-3 top-3"
						onClick={onClose}
						size="icon-lg"
						variant="ghost"
					>
						<X aria-hidden="true" className="size-4" />
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function MapAssetNotice({ campus }: { campus: string }) {
	return (
		<div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6">
			<div className="max-w-sm rounded-2xl border border-border bg-white/95 p-4 text-sm leading-6 text-[var(--sys-text-muted)] shadow-[var(--shadow-sm)]">
				<span className="block font-semibold text-[var(--sys-text-strong)]">{campus}</span>
				当前校区缺少可展示的地图底图。
			</div>
		</div>
	);
}

function useIsDesktopMap() {
	const [matches, setMatches] = useState(() =>
		typeof window === "undefined" ? false : window.matchMedia(DESKTOP_MAP_QUERY).matches,
	);

	useEffect(() => {
		const media = window.matchMedia(DESKTOP_MAP_QUERY);
		const updateMatches = () => setMatches(media.matches);
		updateMatches();
		media.addEventListener("change", updateMatches);
		return () => media.removeEventListener("change", updateMatches);
	}, []);

	return matches;
}

function getNextPlaceIndex(current: number, total: number, direction: 1 | -1) {
	if (total <= 0) {
		return -1;
	}
	const safeCurrent = current >= 0 ? current : direction > 0 ? -1 : 0;
	return (safeCurrent + direction + total) % total;
}
