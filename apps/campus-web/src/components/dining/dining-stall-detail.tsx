import { Badge } from "@campus-agent/ui";
import { MapPin } from "lucide-react";
import type { DiningOfferingProjection, DiningWindowProjection } from "@/features/dining/model";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function StallDetail({
	onSelectOffering,
	selectedOfferingId,
	window: selectedWindow,
}: {
	onSelectOffering(offeringId: string): void;
	selectedOfferingId: string | null;
	window: DiningWindowProjection | null;
}) {
	if (!selectedWindow) {
		return (
			<section
				className="grid min-h-32 place-content-center gap-1 px-2 py-6 text-center"
				data-testid="dining-stall-detail"
			>
				<h2 className="text-sm font-semibold text-[var(--sys-text-strong)]">选择档口</h2>
				<p className="text-sm text-[var(--sys-text-muted)]">在地图上选择档口后查看菜品。</p>
			</section>
		);
	}

	if (!selectedWindow.assignment) {
		return (
			<section className="min-h-40" data-testid="dining-stall-detail">
				<header className="px-1 pb-4 pt-4">
					<h2 className="text-xl font-semibold text-[var(--sys-text-strong)]">
						{selectedWindow.label}
					</h2>
					<WindowLocation locationLabel={selectedWindow.locationLabel} />
				</header>
				<div className="border-border/70 border-t px-1 py-5">
					<p className="text-sm text-[var(--sys-text-muted)]">档口信息待补充</p>
				</div>
			</section>
		);
	}

	const offerings = selectedWindow.assignment.offerings;
	const stallName = selectedWindow.assignment.stallProfile.displayName;
	const selectedOffering = resolveSelectedOffering({ offerings, selectedOfferingId });
	return (
		<section className="min-h-40" data-testid="dining-stall-detail">
			<header className="px-1 pb-4 pt-4">
				<h2 className="text-xl font-semibold text-[var(--sys-text-strong)]">{stallName}</h2>
				<WindowLocation locationLabel={selectedWindow.locationLabel} />
				{selectedWindow.tags.length > 0 ? (
					<div className="mt-3 flex flex-wrap gap-2">
						{selectedWindow.tags.map((tag) => (
							<Badge className="bg-surface-muted text-muted-foreground" key={tag} tone="neutral">
								{tag}
							</Badge>
						))}
					</div>
				) : null}
			</header>
			<div className="border-border/70 border-t">
				<h3 className="px-1 pb-2 pt-4 text-xs font-medium text-[var(--sys-text-subtle)]">菜品</h3>
				{offerings.length > 0 ? (
					<ToggleGroup
						aria-label="菜品"
						className="block divide-y divide-border/70"
						onValueChange={(offeringId) => {
							if (offeringId) {
								onSelectOffering(offeringId);
							}
						}}
						type="single"
						value={selectedOffering?.offeringId ?? ""}
					>
						{offerings.map((offering) => (
							<ToggleGroupItem
								className="min-h-12 w-full justify-between rounded-none border-l-2 border-transparent px-3 py-3 text-left font-normal data-[state=on]:border-l-primary data-[state=on]:bg-[var(--sys-brand-interactive-subtle)] data-[state=on]:text-primary"
								key={offering.offeringId}
								value={offering.offeringId}
							>
								<span className="min-w-0 whitespace-normal text-sm">{offering.name}</span>
								{offering.priceLabel ? (
									<span className="ml-3 shrink-0 text-sm font-semibold">{offering.priceLabel}</span>
								) : null}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				) : (
					<div className="px-1 pb-6 pt-2">
						<p className="text-sm text-[var(--sys-text-muted)]">当前档口暂无菜品信息。</p>
					</div>
				)}
			</div>
		</section>
	);
}

function WindowLocation({ locationLabel }: { locationLabel: string }) {
	return (
		<p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--sys-text-muted)]">
			<MapPin aria-hidden="true" className="size-4 shrink-0 text-primary" />
			<span>{locationLabel}</span>
		</p>
	);
}

function resolveSelectedOffering(input: {
	offerings: DiningOfferingProjection[];
	selectedOfferingId: string | null;
}): DiningOfferingProjection | null {
	return (
		input.offerings.find((offering) => offering.offeringId === input.selectedOfferingId) ?? null
	);
}
