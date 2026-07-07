import { LayoutGroup, motion } from "motion/react";
import type { DiningOfferingProjection, DiningWindowProjection } from "@/features/dining/model";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { contentSwap } from "../ui/motion";
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
	return (
		<LayoutGroup>
			{selectedWindow ? (
				<StallDetailCard
					key={selectedWindow.windowId}
					onSelectOffering={onSelectOffering}
					selectedOfferingId={selectedOfferingId}
					selectedWindow={selectedWindow}
				/>
			) : (
				<motion.div key="empty-stall" layout {...contentSwap}>
					<Card
						className="flex min-h-32 flex-col items-center justify-center border-dashed bg-white px-6 py-8 text-center"
						data-testid="dining-stall-detail"
					>
						<h3 className="font-medium text-foreground text-sm">选择档口</h3>
						<p className="mt-1 max-w-sm text-muted-foreground text-sm">
							选择地图或列表里的档口后查看菜品。
						</p>
					</Card>
				</motion.div>
			)}
		</LayoutGroup>
	);
}

function StallDetailCard({
	onSelectOffering,
	selectedOfferingId,
	selectedWindow,
}: {
	onSelectOffering(offeringId: string): void;
	selectedOfferingId: string | null;
	selectedWindow: DiningWindowProjection;
}) {
	const offerings = selectedWindow.assignment?.offerings ?? [];
	const stallName = selectedWindow.assignment?.stallProfile.displayName ?? selectedWindow.label;
	const selectedOffering = resolveSelectedOffering({ offerings, selectedOfferingId });
	return (
		<motion.div key={selectedWindow.windowId} layout {...contentSwap}>
			<Card className="overflow-hidden" data-testid="dining-stall-detail">
				<div className="border-b border-border p-4">
					<p className="text-xs font-medium text-[var(--sys-text-muted)]">
						{selectedWindow.locationLabel}
					</p>
					<h2 className="mt-2 text-xl font-semibold text-[var(--sys-text-strong)]">{stallName}</h2>
					<div className="mt-3 flex flex-wrap gap-2">
						{selectedWindow.tags.map((tag) => (
							<Badge className="bg-muted text-muted-foreground" key={tag} variant="secondary">
								{tag}
							</Badge>
						))}
					</div>
				</div>
				<div className="divide-y divide-border">
					{offerings.length > 0 ? (
						<div className="space-y-4 p-4">
							<LayoutGroup>
								<ToggleGroup
									aria-label="菜品"
									className="grid grid-cols-1 gap-2"
									onValueChange={(offeringId) => {
										if (offeringId) {
											onSelectOffering(offeringId);
										}
									}}
									type="single"
									value={selectedOffering?.offeringId}
								>
									{offerings.map((offering) => (
										<motion.div key={offering.offeringId} layout {...contentSwap}>
											<ToggleGroupItem
												className="min-h-11 w-full justify-between rounded-lg border border-border px-3 text-left data-[state=on]:border-primary data-[state=on]:bg-[var(--sys-brand-interactive-subtle)] data-[state=on]:text-primary"
												value={offering.offeringId}
											>
												<span className="truncate text-sm">{offering.name}</span>
												{offering.priceLabel ? (
													<span className="ml-3 shrink-0 text-sm font-semibold">
														{offering.priceLabel}
													</span>
												) : null}
											</ToggleGroupItem>
										</motion.div>
									))}
								</ToggleGroup>
							</LayoutGroup>
						</div>
					) : (
						<motion.div
							className="m-4 flex min-h-24 flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-8 text-center"
							key="empty-offerings"
							layout
							{...contentSwap}
						>
							<h3 className="font-medium text-foreground text-sm">暂无菜品</h3>
							<p className="mt-1 max-w-sm text-muted-foreground text-sm">
								当前档口没有已发布菜品。
							</p>
						</motion.div>
					)}
				</div>
			</Card>
		</motion.div>
	);
}

function resolveSelectedOffering(input: {
	offerings: DiningOfferingProjection[];
	selectedOfferingId: string | null;
}): DiningOfferingProjection | null {
	return (
		input.offerings.find((offering) => offering.offeringId === input.selectedOfferingId) ??
		input.offerings[0] ??
		null
	);
}
