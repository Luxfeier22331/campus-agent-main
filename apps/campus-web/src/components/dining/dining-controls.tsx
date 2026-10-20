import {
	Button,
	cn,
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
	StateMessage,
} from "@campus-agent/ui";
import { X } from "lucide-react";
import { useState } from "react";
import type { DiningHallSummary, DiningSearchResult } from "@/features/dining/model";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function DiningHallSwitcher(props: {
	className?: string;
	halls: DiningHallSummary[];
	onSelectHall(hall: DiningHallSummary): void;
	selectedHallId: string;
}) {
	return (
		<Select
			items={props.halls.map((hall) => ({ value: hall.hallId, label: hall.name }))}
			onValueChange={(hallId) => {
				const hall = props.halls.find((item) => item.hallId === hallId);
				if (hall) {
					props.onSelectHall(hall);
				}
			}}
			value={props.selectedHallId}
		>
			<SelectTrigger
				aria-label="选择食堂"
				// Fill-style control matching the floor segmented group: no visible
				// border, the muted fill separates it from the page background.
				className={cn(
					"h-11 rounded-lg border-transparent bg-surface-muted shadow-none enabled:hover:border-transparent enabled:hover:bg-surface-hover data-[popup-open]:border-transparent data-[popup-open]:bg-surface-raised data-[popup-open]:enabled:hover:bg-surface-raised",
					props.className,
				)}
			>
				<SelectValue placeholder="选择食堂" />
			</SelectTrigger>
			<SelectContent align="start">
				{groupHallsByCampus(props.halls).map(([campus, halls]) => (
					<SelectGroup key={campus}>
						<SelectLabel>{campus}</SelectLabel>
						{halls.map((hall) => (
							<SelectItem className="min-h-11" key={hall.hallId} value={hall.hallId}>
								{hall.name}
							</SelectItem>
						))}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}

export function DiningFloorSwitcher(props: {
	className?: string;
	floors: DiningHallSummary["floors"];
	onSelectFloor(floorId: string): void;
	selectedFloorId: string;
}) {
	if (props.floors.length < 2) {
		return null;
	}
	return (
		<ToggleGroup
			aria-label="楼层"
			className={cn("w-fit max-w-full", props.className)}
			presentation="segmented"
			onValueChange={(floorId) => floorId && props.onSelectFloor(floorId)}
			type="single"
			value={props.selectedFloorId}
		>
			{props.floors.map((floor) => (
				<ToggleGroupItem
					className="flex-none whitespace-nowrap"
					key={floor.floorId}
					value={floor.floorId}
				>
					{floor.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

export function DiningWindowSearch(props: {
	className?: string;
	onQueryChange(query: string): void;
	onSelectResult(result: DiningSearchResult): void;
	query: string;
	searchResults: DiningSearchResult[];
	selectedFloorId: string;
}) {
	const [searchOpen, setSearchOpen] = useState(false);
	const showResults = searchOpen && props.query.trim().length > 0;
	return (
		<div className={cn("min-w-0", props.className)}>
			<Command
				className="h-auto min-w-0 overflow-visible rounded-none bg-transparent [&_[cmdk-input-wrapper]]:min-w-0 [&_[cmdk-input-wrapper]]:flex-1 [&_[cmdk-input-wrapper]]:border-b-0"
				shouldFilter={false}
			>
				<Popover onOpenChange={setSearchOpen} open={showResults}>
					<PopoverAnchor asChild>
						<div className="flex min-w-0 overflow-hidden rounded-lg border border-transparent bg-surface-muted transition-colors hover:bg-surface-hover focus-within:bg-surface-raised focus-within:hover:bg-surface-raised">
							<CommandInput
								aria-label="搜索窗口"
								className="h-11"
								onFocus={() => props.query.trim() && setSearchOpen(true)}
								onValueChange={(value) => {
									props.onQueryChange(value);
									setSearchOpen(Boolean(value.trim()));
								}}
								placeholder="搜索全校窗口"
								value={props.query}
							/>
							{props.query ? (
								<Button
									aria-label="清除搜索"
									className="shrink-0 rounded-none"
									onClick={() => {
										props.onQueryChange("");
										setSearchOpen(false);
									}}
									size="icon-lg"
									variant="ghost"
								>
									<X aria-hidden="true" />
								</Button>
							) : null}
						</div>
					</PopoverAnchor>
					<PopoverContent
						align="end"
						className="w-[min(28rem,var(--radix-popover-trigger-width))] p-0 data-[state=closed]:hidden"
						forceMount
						onOpenAutoFocus={(event) => event.preventDefault()}
					>
						<CommandList>
							<CommandEmpty>没有匹配的窗口</CommandEmpty>
							{groupResultsByHall(props.searchResults).map(([hallId, results]) => (
								<CommandGroup
									heading={`${results[0]?.campus} · ${results[0]?.hallName}`}
									key={hallId}
								>
									{results.map((result) => (
										<CommandItem
											className="min-h-11 sm:min-h-9"
											key={result.windowId}
											onSelect={() => {
												if (document.activeElement instanceof HTMLElement) {
													document.activeElement.blur();
												}
												props.onSelectResult(result);
												setSearchOpen(false);
											}}
											value={result.windowId}
										>
											<span className="min-w-0 flex-1 truncate">{result.windowName}</span>
											<span className="shrink-0 text-xs text-[var(--sys-text-subtle)]">
												{result.floorLabel}
											</span>
										</CommandItem>
									))}
								</CommandGroup>
							))}
						</CommandList>
					</PopoverContent>
				</Popover>
			</Command>
			{props.query.trim() &&
			!props.searchResults.some((result) => result.floorId === props.selectedFloorId) ? (
				<StateMessage
					layout="inline"
					role="status"
					className="mt-2"
					description={
						<>
							本层没有匹配的窗口。
							{props.searchResults.length > 0
								? `其他食堂或楼层有 ${props.searchResults.length} 个结果，请从搜索结果选择。`
								: "可清除搜索查看全部窗口。"}
						</>
					}
				/>
			) : null}
		</div>
	);
}

function groupHallsByCampus(halls: DiningHallSummary[]): [string, DiningHallSummary[]][] {
	const groups = new Map<string, DiningHallSummary[]>();
	for (const hall of halls) {
		groups.set(hall.campus, [...(groups.get(hall.campus) ?? []), hall]);
	}
	return [...groups.entries()];
}

function groupResultsByHall(results: DiningSearchResult[]): [string, DiningSearchResult[]][] {
	const groups = new Map<string, DiningSearchResult[]>();
	for (const result of results) {
		groups.set(result.hallId, [...(groups.get(result.hallId) ?? []), result]);
	}
	return [...groups.entries()];
}
