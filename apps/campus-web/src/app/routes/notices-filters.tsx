import {
	Button,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@campus-agent/ui";
import { CalendarDays, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const FILTER_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
	day: "numeric",
	month: "long",
	timeZone: "Asia/Shanghai",
	year: "numeric",
});

export function FilterSelect(props: {
	id: string;
	label: string;
	onChange: (value: string | undefined) => void;
	options: ReadonlyArray<{ label: string; value: string }>;
	value: string | undefined;
}) {
	return (
		<div>
			<Label className="sr-only" htmlFor={props.id}>
				{props.label}
			</Label>
			<Select
				onValueChange={(value) => props.onChange(value === "all" ? undefined : value)}
				value={props.value ?? "all"}
			>
				<SelectTrigger
					aria-label={props.label}
					className="min-h-9 w-auto max-w-56 gap-2 rounded-lg border-border bg-transparent px-3 py-1.5 shadow-none"
					id={props.id}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent align="start">
					<SelectItem value="all">全部分类</SelectItem>
					{props.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export function DateRangeFilter(props: {
	from: string | undefined;
	onClear: () => void;
	onFromChange: (value: string | undefined) => void;
	onToChange: (value: string | undefined) => void;
	to: string | undefined;
}) {
	const label = formatDateRangeLabel(props.from, props.to);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					aria-label={`发布日期：${label}`}
					className={
						props.from || props.to
							? "max-w-full rounded-lg border-[var(--campus-selected-border)] bg-selected px-3 text-selected-foreground shadow-none"
							: "max-w-full rounded-lg border-border bg-transparent px-3 shadow-none"
					}
					size="sm"
					variant="outline"
				>
					<CalendarDays />
					<span className="truncate">{label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[min(22rem,calc(100vw-2rem))] border-border-default bg-surface-raised p-4 shadow-lg"
				sideOffset={8}
			>
				<fieldset className="m-0 border-0 p-0">
					<legend className="text-sm font-medium text-[var(--sys-text-strong)]">发布日期</legend>
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						<div>
							<Label
								className="mb-1.5 block text-xs text-[var(--sys-text-muted)]"
								htmlFor="notice-from"
							>
								开始
							</Label>
							<Input
								className="min-w-0 tabular-nums"
								id="notice-from"
								max={props.to}
								onChange={(event) => props.onFromChange(event.target.value || undefined)}
								type="date"
								value={props.from ?? ""}
							/>
						</div>
						<div>
							<Label
								className="mb-1.5 block text-xs text-[var(--sys-text-muted)]"
								htmlFor="notice-to"
							>
								结束
							</Label>
							<Input
								className="min-w-0 tabular-nums"
								id="notice-to"
								min={props.from}
								onChange={(event) => props.onToChange(event.target.value || undefined)}
								type="date"
								value={props.to ?? ""}
							/>
						</div>
					</div>
					{props.from || props.to ? (
						<Button
							className="mt-3 px-2 text-[var(--sys-text-muted)]"
							onClick={props.onClear}
							size="sm"
							variant="ghost"
						>
							<X />
							清除日期
						</Button>
					) : null}
				</fieldset>
			</PopoverContent>
		</Popover>
	);
}

function formatDateRangeLabel(from: string | undefined, to: string | undefined): string {
	if (!(from || to)) {
		return "发布日期";
	}
	if (from && to) {
		return `${formatFilterDate(from)} - ${formatFilterDate(to)}`;
	}
	return from ? `${formatFilterDate(from)}起` : `${formatFilterDate(to as string)}前`;
}

function formatFilterDate(value: string): string {
	return FILTER_DATE_FORMATTER.format(new Date(`${value}T00:00:00+08:00`));
}
