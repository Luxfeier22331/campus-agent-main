import {
	formatWeekdays,
	selectTransportPeriod,
	shiftTransportDate,
} from "@campus-agent/transport/domain";
import { Button, Input, NativeSelect } from "@campus-agent/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { TransportOpsSchedulePeriod } from "../server/transport-store-contract";

function monthStart(date: string) {
	return `${date.slice(0, 7)}-01`;
}

function monthLabel(date: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		month: "long",
		year: "numeric",
		timeZone: "Asia/Shanghai",
	}).format(new Date(`${date}T00:00:00Z`));
}

function daysInMonth(date: string) {
	const next = new Date(`${monthStart(date)}T00:00:00Z`);
	next.setUTCMonth(next.getUTCMonth() + 1);
	return Math.round(
		(next.getTime() - new Date(`${monthStart(date)}T00:00:00Z`).getTime()) / 86_400_000,
	);
}

function weekday(date: string) {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

function addMonth(date: string, amount: number) {
	const value = new Date(`${monthStart(date)}T00:00:00Z`);
	value.setUTCMonth(value.getUTCMonth() + amount);
	return `${value.toISOString().slice(0, 7)}-01`;
}

export function TransportCalendar({
	periods,
	date,
	month,
	onMonthChange,
	onDateChange,
	onApplyPeriod,
	onSuspendPeriod,
}: {
	periods: readonly TransportOpsSchedulePeriod[];
	date: string;
	month: string;
	onMonthChange: (month: string) => void;
	onDateChange: (date: string) => void;
	onApplyPeriod?: (source: TransportOpsSchedulePeriod, from: string, to: string) => void;
	onSuspendPeriod?: (from: string, to: string) => void;
}) {
	const [range, setRange] = useState({ from: date, to: date });
	const [sourceId, setSourceId] = useState(selectTransportPeriod(periods, date)?.scheduleId ?? "");
	const source = periods.find((p) => p.scheduleId === sourceId);
	const validRange = range.from && range.to && range.from <= range.to;
	const cells = useMemo(() => {
		const first = monthStart(month);
		const count = daysInMonth(first);
		const leading = weekday(first) - 1;
		return Array.from({ length: Math.ceil((leading + count) / 7) * 7 }, (_, index) => {
			if (index < leading || index >= leading + count) {
				return null;
			}
			return shiftTransportDate(first, index - leading);
		});
	}, [month]);
	return (
		<section aria-label="排班月历" className="grid gap-3 rounded-lg border p-3 sm:p-4">
			<header className="flex items-center justify-between gap-2">
				<Button
					aria-label="上个月"
					size="icon"
					variant="ghost"
					onClick={() => onMonthChange(addMonth(month, -1))}
				>
					<ChevronLeft />
				</Button>
				<h3 className="font-semibold">{monthLabel(month)}</h3>
				<Button
					aria-label="下个月"
					size="icon"
					variant="ghost"
					onClick={() => onMonthChange(addMonth(month, 1))}
				>
					<ChevronRight />
				</Button>
			</header>
			<div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
				{["一", "二", "三", "四", "五", "六", "日"].map((label) => (
					<div key={label} className="py-1">
						{label}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7 gap-1">
				{cells.map((cell, index) => {
					if (!cell) {
						// biome-ignore lint/suspicious/noArrayIndexKey: empty calendar cells are fixed positional placeholders.
						return <div aria-hidden="true" key={`empty-${month}-${index}`} />;
					}
					const period = selectTransportPeriod(periods, cell);
					const operating = period?.status === "operating";
					const selected = cell === date;
					return (
						<button
							type="button"
							key={cell}
							aria-label={`${cell}${period ? (operating ? "，运行" : "，停运") : "，无安排"}`}
							aria-pressed={selected}
							onClick={() => onDateChange(cell)}
							className={`min-h-16 rounded-[var(--radius-lg)] border p-1 text-left outline-none transition-colors motion-reduce:transition-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${selected ? "border-border-selected bg-selected text-selected-foreground" : "border-transparent"}`}
						>
							<span className="block text-sm font-semibold tabular-nums">
								{Number(cell.slice(8))}
							</span>
							<span
								className={`block text-[10px] ${period?.status === "suspended" ? "text-danger" : "text-muted-foreground"}`}
							>
								{period ? (operating ? `${period.items.length} 班` : "停运") : "无安排"}
							</span>
						</button>
					);
				})}
			</div>
			{onApplyPeriod || onSuspendPeriod ? (
				<div className="grid gap-3 border-t pt-3">
					<p className="text-sm font-medium">按日期范围安排</p>
					<label className="grid gap-1 text-sm" htmlFor="transport-range-source">
						套用来源时间段
						<NativeSelect
							id="transport-range-source"
							aria-label="套用来源时间段"
							value={sourceId}
							onChange={(e) => setSourceId(e.target.value)}
						>
							<option value="">请选择时间段</option>
							{periods.map((p) => (
								<option key={p.scheduleId} value={p.scheduleId}>
									{p.validFrom} — {p.validTo ?? "长期"} · {formatWeekdays(p.weekdays)} ·{" "}
									{p.status === "suspended" ? "停运" : `${p.items.length}班`}
									{p.note ? ` · ${p.note}` : ""}
								</option>
							))}
						</NativeSelect>
					</label>
					<div className="grid gap-2 sm:grid-cols-2">
						<label className="grid gap-1 text-sm" htmlFor="transport-range-from">
							开始日期
							<Input
								id="transport-range-from"
								type="date"
								value={range.from}
								onChange={(event) => setRange({ ...range, from: event.target.value })}
							/>
						</label>
						<label className="grid gap-1 text-sm" htmlFor="transport-range-to">
							结束日期
							<Input
								id="transport-range-to"
								type="date"
								value={range.to}
								onChange={(event) => setRange({ ...range, to: event.target.value })}
							/>
						</label>
					</div>
					{range.from && range.to && range.from > range.to ? (
						<p role="alert" className="text-sm text-danger">
							结束日期不能早于开始日期。
						</p>
					) : null}
					<div className="flex flex-wrap gap-2">
						{onApplyPeriod ? (
							<Button
								disabled={!(validRange && source)}
								onClick={() => validRange && source && onApplyPeriod(source, range.from, range.to)}
							>
								套用到所选日期
							</Button>
						) : null}
						{onSuspendPeriod ? (
							<Button
								disabled={!validRange}
								variant="outline"
								onClick={() => validRange && onSuspendPeriod(range.from, range.to)}
							>
								设置停运
							</Button>
						) : null}
					</div>
				</div>
			) : null}
		</section>
	);
}
