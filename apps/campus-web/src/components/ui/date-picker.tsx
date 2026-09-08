import { Button } from "@campus-agent/ui";
import { type CalendarDate, parseDate, today } from "@internationalized/date";
import { CalendarDays } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { DateField, DateInput, DateSegment, I18nProvider } from "react-aria-components";
import { CampusCalendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const TIME_ZONE = "Asia/Shanghai";

export function CampusDatePicker({
	value,
	onChange,
	ariaLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	ariaLabel: string;
}) {
	const selected = parseDate(value);
	const [open, setOpen] = useState(false);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-label={ariaLabel}
					className="min-w-0 flex-1 justify-center rounded-lg border-border px-3 shadow-none sm:min-w-48 sm:flex-none"
					size="lg"
					variant="outline"
				>
					<CalendarDays aria-hidden="true" />
					<span className="truncate">{formatDateLabel(value)}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				collisionPadding={16}
				className="w-[min(20rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-4"
				sideOffset={8}
			>
				<CampusCalendar
					onChange={(next) => {
						onChange(next.toString());
						setOpen(false);
					}}
					value={selected}
				/>
			</PopoverContent>
		</Popover>
	);
}

export function CampusDateRangePicker({
	from,
	to,
	onApply,
}: {
	from: string | undefined;
	to: string | undefined;
	onApply: (range: { from: string | undefined; to: string | undefined }) => void;
}) {
	const [open, setOpen] = useState(false);
	const [draftFrom, setDraftFrom] = useState(from);
	const [draftTo, setDraftTo] = useState(to);
	const [fromComplete, setFromComplete] = useState(true);
	const [toComplete, setToComplete] = useState(true);
	const [submitted, setSubmitted] = useState(false);
	const [resetKey, setResetKey] = useState(0);
	const [focusedDate, setFocusedDate] = useState(today(TIME_ZONE));
	const [activeField, setActiveField] = useState<"from" | "to">("from");
	const activeValue = activeField === "from" ? draftFrom : draftTo;
	const calendarValue = activeValue ? parseDate(activeValue) : null;
	const label = formatRangeLabel(from, to);
	const errorId = useId();
	const rangeError = draftFrom && draftTo && draftFrom > draftTo;
	const incomplete = !(fromComplete && toComplete);
	const error = rangeError
		? "开始日期不能晚于结束日期。"
		: submitted && incomplete
			? "请填写完整日期，或清空该日期。"
			: null;

	function focusField(field: "from" | "to", fallback = focusedDate) {
		setActiveField(field);
		const value = field === "from" ? draftFrom : draftTo;
		setFocusedDate(value ? parseDate(value) : fallback);
	}

	function changeOpen(next: boolean) {
		if (next) {
			setDraftFrom(from);
			setDraftTo(to);
			setActiveField("from");
			setFocusedDate(from ? parseDate(from) : to ? parseDate(to) : today(TIME_ZONE));
			setFromComplete(true);
			setToComplete(true);
			setSubmitted(false);
		}
		setOpen(next);
	}

	function selectDate(next: CalendarDate) {
		const value = next.toString();
		if (activeField === "from") {
			setDraftFrom(value);
			focusField("to", next);
		} else {
			setDraftTo(value);
		}
	}

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger asChild>
				<Button
					aria-label={from || to ? `发布日期：${label}` : "发布日期"}
					className={
						from || to
							? "max-w-full rounded-lg border-[var(--campus-selected-border)] bg-selected px-3 text-selected-foreground shadow-none"
							: "max-w-full rounded-lg border-border bg-transparent px-3 shadow-none"
					}
					size="sm"
					variant="outline"
				>
					<CalendarDays aria-hidden="true" />
					<span className="truncate">{label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				collisionPadding={16}
				className="w-[min(22rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto border-border-default bg-surface-raised p-4 shadow-lg"
				sideOffset={8}
			>
				<div className="grid gap-3">
					<fieldset
						key={resetKey}
						className="grid grid-cols-2 gap-2 border-0 p-0"
						aria-label="发布日期范围"
					>
						<DateEndpoint
							label="开始"
							value={draftFrom}
							active={activeField === "from"}
							onFocus={() => focusField("from")}
							onChange={setDraftFrom}
							onCompleteChange={setFromComplete}
							errorId={error ? errorId : undefined}
						/>
						<DateEndpoint
							label="结束"
							value={draftTo}
							active={activeField === "to"}
							onFocus={() => focusField("to")}
							onChange={setDraftTo}
							onCompleteChange={setToComplete}
							errorId={error ? errorId : undefined}
						/>
					</fieldset>
					<CampusCalendar
						value={calendarValue}
						onChange={selectDate}
						focusedValue={focusedDate}
						onFocusChange={setFocusedDate}
					/>
					{error ? (
						<p id={errorId} role="alert" className="text-sm text-danger">
							{error}
						</p>
					) : null}
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
						<Button
							className="justify-start px-2 text-[var(--sys-text-muted)]"
							onClick={() => {
								setDraftFrom(undefined);
								setDraftTo(undefined);
								setActiveField("from");
								setFromComplete(true);
								setToComplete(true);
								setSubmitted(false);
								setResetKey((value) => value + 1);
							}}
							size="sm"
							variant="ghost"
						>
							清除日期
						</Button>
						<div className="flex gap-2">
							<Button variant="ghost" onClick={() => setOpen(false)}>
								取消
							</Button>
							<Button
								onClick={() => {
									setSubmitted(true);
									if (rangeError || incomplete) {
										return;
									}
									onApply({ from: draftFrom, to: draftTo });
									setOpen(false);
								}}
							>
								应用
							</Button>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function DateEndpoint({
	active,
	label,
	onChange,
	onFocus,
	value,
	onCompleteChange,
	errorId,
}: {
	active: boolean;
	label: string;
	onChange: (value: string | undefined) => void;
	onFocus: () => void;
	value: string | undefined;
	onCompleteChange: (complete: boolean) => void;
	errorId: string | undefined;
}) {
	return (
		<div className="grid gap-1">
			<span className="text-xs text-[var(--sys-text-muted)]">{label}</span>
			<I18nProvider locale="zh-CN">
				<DateField
					aria-label={label}
					{...(errorId ? { "aria-describedby": errorId } : {})}
					className={
						active
							? "rounded-md border border-[var(--campus-selected-border)] bg-selected px-2 py-1.5 text-sm text-selected-foreground"
							: "rounded-md border border-border px-2 py-1.5 text-sm text-[var(--sys-text-default)]"
					}
					granularity="day"
					onChange={(next) => onChange(next?.toString())}
					onFocus={onFocus}
					value={value ? parseDate(value) : null}
				>
					{({ state }) => (
						<>
							<DateCompleteness
								complete={
									state.segments
										.filter((segment) => segment.isEditable)
										.every((segment) => segment.isPlaceholder) ||
									state.segments
										.filter((segment) => segment.isEditable)
										.every((segment) => !segment.isPlaceholder)
								}
								onChange={onCompleteChange}
							/>
							<DateInput className="flex min-h-7 min-w-0 items-center justify-center gap-0.5">
								{(segment) => (
									<DateSegment
										className="rounded px-0.5 outline-none focus:bg-background"
										segment={segment}
									/>
								)}
							</DateInput>
						</>
					)}
				</DateField>
			</I18nProvider>
		</div>
	);
}

function DateCompleteness({
	complete,
	onChange,
}: {
	complete: boolean;
	onChange: (complete: boolean) => void;
}) {
	useEffect(() => onChange(complete), [complete, onChange]);
	return null;
}

function formatDateLabel(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		weekday: "short",
		timeZone: TIME_ZONE,
	}).format(new Date(`${value}T00:00:00+08:00`));
}

function formatRangeLabel(from?: string, to?: string): string {
	if (!(from || to)) {
		return "发布日期";
	}
	if (from && to) {
		return `${formatLongDate(from)} - ${formatLongDate(to)}`;
	}
	return from ? `${formatLongDate(from)}起` : `${formatLongDate(to as string)}前`;
}

function formatLongDate(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: TIME_ZONE,
	}).format(new Date(`${value}T00:00:00+08:00`));
}
