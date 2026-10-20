import { Button, cn, focusRing } from "@campus-agent/ui";
import { motion } from "motion/react";
import { useState } from "react";
import { contentSwap } from "@/components/ui/motion";
import { groupMapPlacesForDisplay, type MapPlaceView } from "@/features/map/view-model";

const DEFAULT_VISIBLE_PLACES_PER_GROUP = 5;

export function PlaceList({
	activeResultIndex,
	forceExpanded,
	onClearFilters,
	onPlaceSelect,
	places,
	selectedPlaceId,
}: {
	activeResultIndex: number;
	forceExpanded: boolean;
	onClearFilters: () => void;
	onPlaceSelect: (placeId: string) => void;
	places: MapPlaceView[];
	selectedPlaceId: string | null;
}) {
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
	if (places.length === 0) {
		return (
			<section aria-label="地点结果">
				<div className="flex min-h-32 flex-col items-center justify-center rounded-lg px-6 py-8 text-center">
					<h3 className="font-medium text-foreground text-sm">没有找到匹配地点。</h3>
					<p className="mt-1 max-w-sm text-muted-foreground text-sm">
						调整搜索词或筛选条件后再试。
					</p>
					<Button className="mt-4" onClick={onClearFilters} type="button" variant="outline">
						清除筛选
					</Button>
				</div>
			</section>
		);
	}

	const groups = groupMapPlacesForDisplay(places, { sortWithinGroups: true });
	let placeIndex = 0;

	return (
		<motion.section aria-label="地点结果" className="space-y-3" layout>
			{groups.map((group) => {
				const expanded = forceExpanded || expandedGroups.has(group.label);
				const visiblePlaces = expanded
					? group.places
					: group.places.slice(0, DEFAULT_VISIBLE_PLACES_PER_GROUP);
				const canToggle = group.places.length > DEFAULT_VISIBLE_PLACES_PER_GROUP;
				return (
					<motion.fieldset className="space-y-1" key={group.label} layout>
						<legend className="ui-metadata px-2 font-semibold">{group.label}</legend>
						{visiblePlaces.map((place) => {
							const currentIndex = placeIndex;
							placeIndex += 1;
							const selected = selectedPlaceId === place.place.id;
							const active = activeResultIndex === currentIndex;
							return (
								<motion.div key={place.place.id} layout {...contentSwap}>
									<Button
										aria-label={`选择${place.place.title}`}
										aria-pressed={selected}
										className={cn(
											`h-auto min-h-[76px] w-full flex-col items-start rounded-lg border border-transparent bg-[var(--map-overlay-surface-soft)] p-2.5 text-left whitespace-normal outline-none hover:bg-[var(--map-overlay-surface-hover)] ${focusRing}`,
											active &&
												"border-[var(--sys-border-default)] bg-[var(--map-overlay-surface)]",
											selected && "border-border-selected bg-selected",
										)}
										onClick={() => onPlaceSelect(place.place.id)}
										variant="ghost"
									>
										<span className="block text-sm font-semibold text-[var(--sys-text-strong)]">
											{place.place.title}
										</span>
										<span className="ui-metadata mt-0.5 block">
											{place.place.campus} · {place.categoryLabel}
										</span>
										<span className="mt-1 line-clamp-1 block text-xs leading-5 text-[var(--sys-text-muted)]">
											{place.place.description}
										</span>
									</Button>
								</motion.div>
							);
						})}
						{canToggle && !forceExpanded ? (
							<Button
								className={`min-h-10 rounded-lg px-2 text-sm font-medium text-[var(--map-overlay-muted)] outline-none hover:bg-[var(--map-overlay-surface-hover)] hover:text-[var(--map-overlay-text)] ${focusRing}`}
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
					</motion.fieldset>
				);
			})}
		</motion.section>
	);
}
