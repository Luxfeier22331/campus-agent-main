import { motion } from "motion/react";
import type { DiningHallSummary } from "@/features/dining/model";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { contentSwap } from "../ui/motion";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function HallSelector({
	halls,
	onSelectHall,
	selectedHallId,
}: {
	halls: DiningHallSummary[];
	onSelectHall(hall: DiningHallSummary): void;
	selectedHallId: string;
}) {
	if (halls.length === 0) {
		return (
			<Card className="flex min-h-32 flex-col items-center justify-center border-dashed px-6 py-8 text-center">
				<h3 className="font-medium text-foreground text-sm">没有匹配的食堂、档口或菜品</h3>
				<p className="mt-1 max-w-sm text-muted-foreground text-sm">调整搜索词或筛选条件后再试。</p>
			</Card>
		);
	}
	return (
		<motion.ul className="flex list-none gap-2 overflow-x-auto p-0 pb-1" layout>
			{halls.map((hall) => (
				<motion.li className="shrink-0" key={hall.hallId} layout {...contentSwap}>
					<Button
						className={cn(
							"min-h-10 rounded-lg border border-border bg-white px-4 text-sm text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] hover:border-[var(--sys-text-strong)]",
							selectedHallId === hall.hallId &&
								"border-[var(--sys-text-strong)] bg-[var(--sys-text-strong)] text-white hover:text-white",
						)}
						onClick={() => onSelectHall(hall)}
						variant="secondary"
					>
						{hall.name}
					</Button>
				</motion.li>
			))}
		</motion.ul>
	);
}

export function TagFilters({
	onSelectTag,
	selectedTag,
	tags,
}: {
	onSelectTag(tag: string | null): void;
	selectedTag: string | null;
	tags: string[];
}) {
	return (
		<div className="-mx-1 overflow-x-auto px-1 pb-1">
			<ToggleGroup
				aria-label="餐饮标签"
				className="w-max justify-start md:w-auto md:flex-wrap"
				onValueChange={(value) => onSelectTag(value && value !== "all" ? value : null)}
				type="single"
				value={selectedTag ?? "all"}
			>
				<ToggleGroupItem className="shrink-0 rounded-full" value="all">
					全部
				</ToggleGroupItem>
				{tags.map((tag) => (
					<ToggleGroupItem className="shrink-0 rounded-full" key={tag} value={tag}>
						{tag}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	);
}
