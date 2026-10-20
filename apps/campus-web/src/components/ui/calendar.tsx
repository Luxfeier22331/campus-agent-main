import { buttonVariants, cn, focusRing } from "@campus-agent/ui";
import { type CalendarDate, today } from "@internationalized/date";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
	Calendar as AriaCalendar,
	Button,
	CalendarCell,
	CalendarGrid,
	CalendarGridBody,
	CalendarGridHeader,
	CalendarHeaderCell,
	CalendarHeading,
	I18nProvider,
} from "react-aria-components";

const TIME_ZONE = "Asia/Shanghai";

export function CampusCalendar({
	value,
	onChange,
	defaultFocusedValue,
	focusedValue,
	onFocusChange,
	renderDay,
}: {
	value: CalendarDate | null;
	onChange: (value: CalendarDate) => void;
	defaultFocusedValue?: CalendarDate;
	focusedValue?: CalendarDate;
	onFocusChange?: (value: CalendarDate) => void;
	renderDay?: (date: CalendarDate) => ReactNode;
}) {
	return (
		<I18nProvider locale="zh-CN">
			<AriaCalendar
				className="grid gap-3"
				defaultFocusedValue={defaultFocusedValue ?? value ?? today(TIME_ZONE)}
				{...(focusedValue ? { focusedValue } : {})}
				{...(onFocusChange ? { onFocusChange } : {})}
				firstDayOfWeek="mon"
				onChange={onChange}
				value={value}
			>
				<div className="flex items-center justify-between gap-3">
					<Button
						aria-label="上个月"
						className={cn(
							buttonVariants({ variant: "ghost", size: "icon" }),
							"text-muted-foreground",
						)}
						slot="previous"
					>
						<ChevronLeft aria-hidden="true" className="size-4" />
					</Button>
					<CalendarHeading className="text-sm font-semibold text-[var(--sys-text-strong)]" />
					<Button
						aria-label="下个月"
						className={cn(
							buttonVariants({ variant: "ghost", size: "icon" }),
							"text-muted-foreground",
						)}
						slot="next"
					>
						<ChevronRight aria-hidden="true" className="size-4" />
					</Button>
				</div>
				<CalendarGrid className="w-full table-fixed" weekdayStyle="short">
					<CalendarGridHeader>
						{(day) => (
							<CalendarHeaderCell className="pb-1 text-center text-xs font-medium text-[var(--sys-text-muted)]">
								{day}
							</CalendarHeaderCell>
						)}
					</CalendarGridHeader>
					<CalendarGridBody>
						{(date) => (
							<CalendarCell
								className={`m-0.5 grid min-h-11 place-items-center rounded-[var(--radius-lg)] border border-transparent text-sm text-[var(--sys-text-default)] outline-none hover:bg-surface-muted ${focusRing} data-[disabled]:text-[var(--sys-text-muted)] data-[outside-month]:text-[var(--sys-text-muted)] data-[selected]:border-border-selected data-[selected]:bg-selected data-[selected]:font-semibold data-[selected]:text-selected-foreground data-[today]:font-semibold data-[today]:underline data-[today]:decoration-2 data-[today]:underline-offset-4`}
								date={date}
							>
								{renderDay ? () => renderDay(date) : undefined}
							</CalendarCell>
						)}
					</CalendarGridBody>
				</CalendarGrid>
			</AriaCalendar>
		</I18nProvider>
	);
}
