import { List, LocateFixed, MapPin, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import type { CampusMapPlaceCategory } from "@/features/map/model";
import type { MapCategoryFilter, MapPlaceView } from "@/features/map/view-model";
import { cn } from "@/lib/utils";

const DESKTOP_MAP_QUERY = "(min-width: 960px)";

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
}: {
	assetAvailable: boolean;
	campuses: string[];
	categories: Array<{ label: string; value: CampusMapPlaceCategory }>;
	category: MapCategoryFilter;
	campus: string;
	campusNotice: string | null;
	filteredPlaces: MapPlaceView[];
	mapRef: RefObject<HTMLElement | null>;
	onCanvasClick: () => void;
	onCategoryChange: (category: MapCategoryFilter) => void;
	onCampusChange: (campus: string) => void;
	onPlaceSelect: (placeId: string) => void;
	onQueryChange: (query: string) => void;
	onResetViewport: () => void;
	query: string;
	selectedPlace: MapPlaceView | null;
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
				onListExpandedChange={setPlaceListExpanded}
				onPlaceSelect={onPlaceSelect}
				onQueryChange={onQueryChange}
				places={filteredPlaces}
				query={query}
				selectedPlaceId={selectedPlace?.place.id ?? null}
			/>
			{isDesktop || !selectedPlace ? (
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
		<a
			className="inline-flex min-h-8 items-center rounded-full px-2.5 text-[var(--sys-text-muted)] outline-none hover:bg-white/72 hover:text-[var(--sys-text-strong)] focus-visible:shadow-[var(--state-focus-shadow)]"
			href={href}
		>
			{children}
		</a>
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
	onListExpandedChange,
	onPlaceSelect,
	onQueryChange,
	places,
	query,
	selectedPlaceId,
}: {
	campuses: string[];
	categories: Array<{ label: string; value: CampusMapPlaceCategory }>;
	category: MapCategoryFilter;
	campus: string;
	campusNotice: string | null;
	compactResults: boolean;
	isDesktop: boolean;
	listExpanded: boolean;
	onCategoryChange: (category: MapCategoryFilter) => void;
	onCampusChange: (campus: string) => void;
	onListExpandedChange: (expanded: boolean) => void;
	onPlaceSelect: (placeId: string) => void;
	onQueryChange: (query: string) => void;
	places: MapPlaceView[];
	query: string;
	selectedPlaceId: string | null;
}) {
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
			<div className={cn("space-y-2 p-2.5", listExpanded && "border-b border-white/60")}>
				<div className="flex items-center gap-2">
					<form
						aria-label="地点搜索"
						className="min-w-0 flex-1"
						onSubmit={(event) => event.preventDefault()}
					>
						<div className="relative">
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--sys-text-subtle)]"
							/>
							<Input
								aria-label="搜索地点"
								className={cn(
									"rounded-full border-white/70 bg-white/72 pl-9 pr-3 shadow-[var(--shadow-xs)]",
									isDesktop ? "min-h-10" : "min-h-11",
								)}
								onChange={(event) => {
									onListExpandedChange(true);
									onQueryChange(event.target.value);
								}}
								onFocus={() => onListExpandedChange(true)}
								placeholder="搜索地点"
								type="search"
								value={query}
							/>
						</div>
					</form>
					{compactResults ? null : (
						<button
							aria-controls="campus-map-results"
							aria-expanded={listExpanded}
							aria-label={listExpanded ? "收起地点结果" : "展开地点结果"}
							className={cn(
								"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 font-medium text-[var(--sys-text-muted)] outline-none hover:bg-white/72 hover:text-[var(--sys-text-strong)] focus-visible:shadow-[var(--state-focus-shadow)]",
								isDesktop ? "min-h-10 text-xs" : "min-h-11 text-sm",
							)}
							onClick={() => onListExpandedChange(!listExpanded)}
							title={listExpanded ? "收起地点结果" : "展开地点结果"}
							type="button"
						>
							<List aria-hidden="true" className="size-4" />
							<span className="hidden sm:inline">{listExpanded ? "收起" : "地点"}</span>
						</button>
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
						places={places}
						selectedPlaceId={selectedPlaceId}
						onPlaceSelect={onPlaceSelect}
					/>
				</div>
			) : null}
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
		<fieldset className="flex gap-1.5 overflow-x-auto pb-0.5">
			<legend className="sr-only">选择校区</legend>
			{campuses.map((item) => (
				<FilterButton
					active={campus === item}
					isDesktop={isDesktop}
					key={item}
					onClick={() => onCampusChange(item)}
				>
					{item}
				</FilterButton>
			))}
		</fieldset>
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
	categories: Array<{ label: string; value: CampusMapPlaceCategory }>;
	category: MapCategoryFilter;
	isDesktop: boolean;
	onCategoryChange: (campus: MapCategoryFilter) => void;
}) {
	return (
		<fieldset className="flex gap-1.5 overflow-x-auto pb-0.5">
			<legend className="sr-only">地点类型</legend>
			<FilterButton
				active={category === "all"}
				isDesktop={isDesktop}
				onClick={() => onCategoryChange("all")}
			>
				全部类型
			</FilterButton>
			{categories.map((item) => (
				<FilterButton
					active={category === item.value}
					isDesktop={isDesktop}
					key={item.value}
					onClick={() => onCategoryChange(item.value)}
				>
					{item.label}
				</FilterButton>
			))}
		</fieldset>
	);
}

function FilterButton({
	active,
	children,
	isDesktop,
	onClick,
}: {
	active: boolean;
	children: string;
	isDesktop: boolean;
	onClick: () => void;
}) {
	return (
		<button
			aria-pressed={active}
			className={cn(
				"inline-flex shrink-0 items-center rounded-full border border-white/70 bg-white/58 font-medium text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] outline-none hover:bg-white/80 hover:text-[var(--sys-text-strong)] focus-visible:shadow-[var(--state-focus-shadow)]",
				isDesktop ? "min-h-9 px-3 text-sm" : "min-h-11 px-3.5 text-sm",
				active &&
					"border-[var(--sys-text-strong)] bg-[var(--sys-text-strong)] text-white hover:bg-[var(--sys-text-default)] hover:text-white",
			)}
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
	);
}

function PlaceList({
	onPlaceSelect,
	places,
	selectedPlaceId,
}: {
	onPlaceSelect: (placeId: string) => void;
	places: MapPlaceView[];
	selectedPlaceId: string | null;
}) {
	if (places.length === 0) {
		return <InlineEmptyState message="没有找到匹配地点。" />;
	}

	return (
		<div className="space-y-1">
			{places.map((place) => {
				const selected = selectedPlaceId === place.place.id;
				return (
					<button
						aria-label={`选择${place.place.title}`}
						aria-pressed={selected}
						className={cn(
							"w-full rounded-lg border border-transparent bg-white/58 p-2.5 text-left outline-none hover:bg-white/82 focus-visible:shadow-[var(--state-focus-shadow)]",
							selected && "border-[var(--sys-text-strong)] bg-white/88",
						)}
						key={place.place.id}
						onClick={() => onPlaceSelect(place.place.id)}
						type="button"
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
					</button>
				);
			})}
		</div>
	);
}

function MapViewportControls({ onResetViewport }: { onResetViewport: () => void }) {
	return (
		<div className="pointer-events-auto absolute bottom-8 right-3 z-30 flex flex-col items-end gap-2">
			<button
				aria-label="回到当前校区"
				className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/70 bg-white/82 px-3 text-sm font-medium text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] outline-none backdrop-blur-md hover:bg-white/92 hover:text-[var(--sys-text-strong)] focus-visible:shadow-[var(--state-focus-shadow)]"
				onClick={onResetViewport}
				type="button"
			>
				<LocateFixed aria-hidden="true" className="size-4" />
				<span className="hidden sm:inline">当前校区</span>
			</button>
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
	return (
		<div
			aria-label={place.place.title}
			className={cn(
				"pointer-events-auto absolute z-30 border border-white/70 bg-white/86 shadow-[var(--shadow-sm)] backdrop-blur-md",
				isDesktop
					? "left-[384px] top-20 w-[min(340px,calc(100vw-412px))] rounded-2xl"
					: "inset-x-3 bottom-3 rounded-2xl pb-[max(0px,env(safe-area-inset-bottom))]",
			)}
			data-variant={isDesktop ? "popover" : "sheet"}
			role="dialog"
		>
			<div className="flex items-start gap-3 p-4">
				<span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--sys-brand-interactive-subtle)] text-primary">
					<MapPin aria-hidden="true" className="size-5" />
				</span>
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-base font-semibold tracking-normal text-[var(--sys-text-strong)]">
						{place.place.title}
					</h2>
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
							<span
								className="rounded-full bg-[var(--sys-bg-muted)] px-3 py-1 text-xs text-[var(--sys-text-muted)]"
								key={tag}
							>
								{tag}
							</span>
						))}
					</div>
				</div>
				<button
					aria-label="关闭地点详情"
					className="grid size-10 shrink-0 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]"
					onClick={onClose}
					type="button"
				>
					<X aria-hidden="true" className="size-4" />
				</button>
			</div>
		</div>
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

function InlineEmptyState({ message }: { message: string }) {
	return <div className="px-3 py-6 text-sm text-[var(--sys-text-muted)]">{message}</div>;
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
