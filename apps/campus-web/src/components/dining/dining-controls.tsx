import {
	Button,
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@campus-agent/ui";
import { X } from "lucide-react";
import { useState } from "react";
import type { DiningHallSummary, DiningSearchResult } from "@/features/dining/model";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function DiningHallSwitcher(props: {
	halls: DiningHallSummary[];
	onSelectHall(hall: DiningHallSummary): void;
	selectedHallId: string;
}) {
	const hallGroups = groupHallsByCampus(props.halls);
	return (
		<>
			<div className="hidden flex-wrap items-center gap-x-6 gap-y-3 lg:flex">
				{hallGroups.map(([campus, halls]) => (
					<fieldset
						aria-label={campus}
						className="flex min-w-0 flex-wrap items-center gap-2"
						key={campus}
					>
						<span className="text-xs font-medium text-[var(--sys-text-subtle)]">{campus}</span>
						<ToggleGroup
							aria-label={`${campus}食堂`}
							onValueChange={(hallId) => {
								const hall = halls.find((item) => item.hallId === hallId);
								if (hall) {
									props.onSelectHall(hall);
								}
							}}
							presentation="segmented"
							type="single"
							value={props.selectedHallId}
						>
							{halls.map((hall) => (
								<ToggleGroupItem key={hall.hallId} value={hall.hallId}>
									{hall.name}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</fieldset>
				))}
			</div>
			<div className="lg:hidden">
				<Select
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
						className="h-11 rounded-lg bg-background shadow-none"
					>
						<SelectValue placeholder="选择食堂" />
					</SelectTrigger>
					<SelectContent align="start">
						{hallGroups.map(([campus, halls]) => (
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
			</div>
		</>
	);
}

export function DiningMapToolbar(props: {
	floors: DiningHallSummary["floors"];
	onQueryChange(query: string): void;
	onSelectFloor(floorId: string): void;
	onSelectResult(result: DiningSearchResult): void;
	query: string;
	searchResults: DiningSearchResult[];
	selectedFloorId: string;
}) {
	const [searchOpen, setSearchOpen] = useState(false);
	const showResults = searchOpen && props.query.trim().length > 0;
	return (
		<div className="border-border/70 border-b px-3 py-3 sm:px-4">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				{props.floors.length > 1 ? (
					<ToggleGroup
						aria-label="楼层"
						className="w-fit shrink-0"
						presentation="segmented"
						onValueChange={(floorId) => floorId && props.onSelectFloor(floorId)}
						type="single"
						value={props.selectedFloorId}
					>
						{props.floors.map((floor) => (
							<ToggleGroupItem key={floor.floorId} value={floor.floorId}>
								{floor.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				) : null}
				<Command
					className="h-auto min-w-0 flex-1 overflow-visible rounded-none bg-transparent [&_[cmdk-input-wrapper]]:min-w-0 [&_[cmdk-input-wrapper]]:flex-1 [&_[cmdk-input-wrapper]]:border-b-0"
					shouldFilter={false}
				>
					<Popover onOpenChange={setSearchOpen} open={showResults}>
						<PopoverAnchor asChild>
							<div className="flex min-w-0 overflow-hidden rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
								<CommandInput
									aria-label="搜索窗口"
									className="h-11"
									onFocus={() => props.query.trim() && setSearchOpen(true)}
									onValueChange={(value) => {
										props.onQueryChange(value);
										setSearchOpen(Boolean(value.trim()));
									}}
									placeholder="搜索窗口"
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
							className="w-[min(28rem,calc(100vw-2rem))] p-0 data-[state=closed]:hidden"
							forceMount
							onOpenAutoFocus={(event) => event.preventDefault()}
						>
							<CommandList>
								<CommandEmpty>没有匹配的窗口</CommandEmpty>
								{props.searchResults.map((result) => (
									<CommandItem
										className="min-h-11 sm:min-h-9"
										key={result.windowId}
										onSelect={() => {
											props.onSelectResult(result);
											setSearchOpen(false);
										}}
										value={`${result.windowName} ${result.floorLabel}`}
									>
										<span className="min-w-0 flex-1 truncate">{result.windowName}</span>
										<span className="shrink-0 text-xs text-[var(--sys-text-subtle)]">
											{result.floorLabel}
										</span>
									</CommandItem>
								))}
							</CommandList>
						</PopoverContent>
					</Popover>
				</Command>
			</div>
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
