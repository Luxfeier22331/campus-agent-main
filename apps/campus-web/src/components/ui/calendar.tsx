import { type CalendarDate, today } from "@internationalized/date";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
}: {
	value: CalendarDate | null;
	onChange: (value: CalendarDate) => void;
	defaultFocusedValue?: CalendarDate;
	focusedValue?: CalendarDate;
	onFocusChange?: (value: CalendarDate) => void;
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
						className="grid size-11 place-items-center rounded-md text-[var(--sys-text-muted)] hover:bg-surface-muted hover:text-[var(--sys-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						slot="previous"
					>
						<ChevronLeft aria-hidden="true" className="size-4" />
					</Button>
					<CalendarHeading className="text-sm font-semibold text-[var(--sys-text-strong)]" />
					<Button
						aria-label="下个月"
						className="grid size-11 place-items-center rounded-md text-[var(--sys-text-muted)] hover:bg-surface-muted hover:text-[var(--sys-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
								className="m-0.5 grid aspect-square place-items-center rounded-md text-sm text-[var(--sys-text-default)] outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:text-[var(--sys-text-muted)] data-[outside-month]:text-[var(--sys-text-muted)] data-[selected]:bg-selected data-[selected]:font-semibold data-[selected]:text-selected-foreground data-[today]:font-semibold"
								date={date}
							/>
						)}
					</CalendarGridBody>
				</CalendarGrid>
			</AriaCalendar>
		</I18nProvider>
	);
}
