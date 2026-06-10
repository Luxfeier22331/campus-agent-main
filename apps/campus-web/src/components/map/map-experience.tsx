import { ArrowRight, MapPin, MessageCircle } from "lucide-react";
import type { RefObject } from "react";

import { EmptyPanel } from "@/components/shell/state-panels";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CampusMapPlaceCategory } from "@/features/map/model";
import type { MapCategoryFilter, MapPlaceView } from "@/features/map/view-model";
import { buildPlaceFeedbackHref, buildPlaceQuestionHref } from "@/features/map/view-model";
import { cn } from "@/lib/utils";

export function MapExperience({
	campuses,
	categories,
	category,
	campus,
	filteredPlaces,
	mapRef,
	onCategoryChange,
	onCampusChange,
	onPlaceSelect,
	onQueryChange,
	query,
	selectedPlace,
}: {
	campuses: string[];
	categories: Array<{ label: string; value: CampusMapPlaceCategory }>;
	category: MapCategoryFilter;
	campus: string;
	filteredPlaces: MapPlaceView[];
	mapRef: RefObject<HTMLDivElement | null>;
	onCategoryChange: (category: MapCategoryFilter) => void;
	onCampusChange: (campus: string) => void;
	onPlaceSelect: (placeId: string) => void;
	onQueryChange: (query: string) => void;
	query: string;
	selectedPlace: MapPlaceView | null;
}) {
	return (
		<div className="space-y-4">
			<Card className="p-3">
				<div className="grid gap-3 xl:grid-cols-[minmax(280px,420px)_1fr] xl:items-start">
					<form aria-label="地点搜索" onSubmit={(event) => event.preventDefault()}>
						<Input
							aria-label="搜索地点"
							onChange={(event) => onQueryChange(event.target.value)}
							placeholder="搜索地点"
							type="search"
							value={query}
						/>
					</form>
					<MapFilters
						campuses={campuses}
						categories={categories}
						category={category}
						campus={campus}
						onCategoryChange={onCategoryChange}
						onCampusChange={onCampusChange}
					/>
				</div>
			</Card>
			<div className="grid gap-3 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(300px,360px)]">
				<Card className="flex min-h-[320px] flex-col p-3">
					<PlaceList
						places={filteredPlaces}
						selectedPlaceId={selectedPlace?.place.id ?? null}
						onPlaceSelect={onPlaceSelect}
					/>
				</Card>
				<section
					aria-label="校园地图画布"
					className="min-h-[min(64dvh,560px)] overflow-hidden rounded-xl border border-border bg-[var(--map-canvas-bg)] shadow-[var(--shadow-xs)] lg:min-h-[var(--layout-map-canvas-min-height)]"
					ref={mapRef}
				/>
				<Card className="p-4">
					{selectedPlace ? (
						<PlaceDetail place={selectedPlace} />
					) : (
						<EmptyPanel message="没有可查看的地点详情。" />
					)}
				</Card>
			</div>
		</div>
	);
}

function MapFilters({
	campuses,
	categories,
	category,
	campus,
	onCategoryChange,
	onCampusChange,
}: {
	campuses: string[];
	categories: Array<{ label: string; value: CampusMapPlaceCategory }>;
	category: MapCategoryFilter;
	campus: string;
	onCategoryChange: (campus: MapCategoryFilter) => void;
	onCampusChange: (campus: string) => void;
}) {
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-2">
				<FilterButton active={campus === "all"} onClick={() => onCampusChange("all")}>
					全部校区
				</FilterButton>
				{campuses.map((item) => (
					<FilterButton active={campus === item} key={item} onClick={() => onCampusChange(item)}>
						{item}
					</FilterButton>
				))}
			</div>
			<div className="flex flex-wrap gap-2">
				<FilterButton active={category === "all"} onClick={() => onCategoryChange("all")}>
					全部类型
				</FilterButton>
				{categories.map((item) => (
					<FilterButton
						active={category === item.value}
						key={item.value}
						onClick={() => onCategoryChange(item.value)}
					>
						{item.label}
					</FilterButton>
				))}
			</div>
		</div>
	);
}

function FilterButton({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: string;
	onClick: () => void;
}) {
	return (
		<button
			aria-pressed={active}
			className={cn(
				"min-h-9 rounded-lg border border-border bg-white px-3 text-sm font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]",
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
		return (
			<div className="mt-3">
				<EmptyPanel message="没有找到匹配地点。" />
			</div>
		);
	}

	return (
		<div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
			{places.map((place) => {
				const selected = selectedPlaceId === place.place.id;
				return (
					<button
						aria-label={`选择${place.place.title}`}
						aria-pressed={selected}
						className={cn(
							"w-full rounded-xl border border-border bg-white p-3 text-left shadow-[var(--shadow-xs)] hover:border-[var(--sys-border-default)] hover:bg-[var(--sys-bg-subtle)]",
							selected && "border-[var(--sys-text-strong)] bg-[var(--sys-bg-muted)]",
						)}
						key={place.place.id}
						onClick={() => onPlaceSelect(place.place.id)}
						type="button"
					>
						<span className="block text-sm font-semibold text-[var(--sys-text-strong)]">
							选择{place.place.title}
						</span>
						<span className="mt-1 block text-xs text-[var(--sys-text-muted)]">
							{place.place.campus} · {place.categoryLabel}
						</span>
						<span className="mt-2 line-clamp-2 block text-sm leading-6 text-[var(--sys-text-muted)]">
							{place.place.description}
						</span>
					</button>
				);
			})}
		</div>
	);
}

function PlaceDetail({ place }: { place: MapPlaceView }) {
	return (
		<div>
			<span className="grid size-10 place-items-center rounded-lg bg-[var(--sys-brand-interactive-subtle)] text-primary">
				<MapPin aria-hidden="true" className="size-5" />
			</span>
			<h2 className="mt-4 text-xl font-semibold text-[var(--sys-text-strong)]">
				{place.place.title}
			</h2>
			<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">
				{place.place.description}
			</p>
			<div className="mt-4 space-y-2">
				{place.detailRows.map((row) => (
					<div className="grid grid-cols-[72px_1fr] gap-3 text-sm" key={row.label}>
						<span className="text-[var(--sys-text-subtle)]">{row.label}</span>
						<span className="text-[var(--sys-text-muted)]">{row.value}</span>
					</div>
				))}
			</div>
			<div className="mt-4 flex flex-wrap gap-2">
				{place.displayTags.map((tag) => (
					<span
						className="rounded-full bg-[var(--sys-bg-muted)] px-3 py-1 text-xs text-[var(--sys-text-muted)]"
						key={tag}
					>
						{tag}
					</span>
				))}
			</div>
			<div className="mt-5 flex flex-col gap-2">
				<a
					className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--sys-text-strong)] px-4 text-sm font-medium text-white hover:bg-[var(--sys-text-default)]"
					href={buildPlaceQuestionHref(place.place.title)}
				>
					<MessageCircle aria-hidden="true" className="size-4" />
					询问这个地点
				</a>
				<a
					className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-medium text-[var(--sys-brand-identity)] hover:bg-[var(--sys-brand-identity-subtle)]"
					href={buildPlaceFeedbackHref(place.place.id)}
				>
					反馈地点信息
					<ArrowRight aria-hidden="true" className="size-4" />
				</a>
			</div>
		</div>
	);
}
