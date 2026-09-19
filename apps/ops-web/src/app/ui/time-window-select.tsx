import { Button, Input, NativeSelect } from "@campus-agent/ui";
import {
	beijingDate,
	dateRangeQuery,
	TIME_SCOPE,
	TIME_WINDOW_LABELS,
	TIME_WINDOWS,
	type TimeFilters,
	type TimeQuery,
	type TimeScope,
	type TimeWindow,
} from "campus-contracts/ops-time";
import { useEffect, useState } from "react";
import { formatTimestamp } from "../format";
import type { TimeSearch } from "../time-filters";

export function timeWindowOptions(_scope: TimeScope): Array<{ label: string; value: TimeWindow }> {
	return TIME_WINDOWS.map((value) => ({ label: TIME_WINDOW_LABELS[value], value }));
}

export function TimeRangeFilter({
	search,
	scope,
	onChange,
}: {
	search: TimeSearch;
	scope: TimeScope;
	onChange: (query: TimeQuery) => void;
}) {
	const { window, from, to, timeError } = search;
	const [custom, setCustom] = useState(Boolean(from || to || timeError));
	const [start, setStart] = useState(inputDate(from));
	const [end, setEnd] = useState(inputDate(to, true));
	const [error, setError] = useState<string>();
	useEffect(() => {
		setCustom(Boolean(timeError || (!window && (from || to))));
		setStart(inputDate(from));
		setEnd(inputDate(to, true));
		setError(undefined);
	}, [window, from, to, timeError]);
	return (
		<div className="grid gap-2">
			<label htmlFor="time-window" className="grid gap-1 text-sm">
				时间范围
				<NativeSelect
					id="time-window"
					aria-label="时间范围"
					className="min-h-11"
					value={custom ? "custom" : (window ?? "today")}
					onChange={(event) => {
						setError(undefined);
						if (event.target.value === "custom") {
							setCustom(true);
							return;
						}
						setCustom(false);
						onChange({ window: event.target.value as TimeWindow });
					}}
				>
					{timeWindowOptions(scope).map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
					<option value="custom">选择日期</option>
				</NativeSelect>
			</label>
			{custom ? (
				<div className="flex flex-wrap items-end gap-2">
					<label htmlFor="time-start" className="grid gap-1 text-xs">
						开始日期
						<Input
							id="time-start"
							aria-label="开始日期"
							type="date"
							value={start}
							onChange={(event) => setStart(event.target.value)}
						/>
					</label>
					<label htmlFor="time-end" className="grid gap-1 text-xs">
						结束日期
						<Input
							id="time-end"
							aria-label="结束日期"
							type="date"
							value={end}
							onChange={(event) => setEnd(event.target.value)}
						/>
					</label>
					<Button
						type="button"
						onClick={() => {
							try {
								const query = dateRangeQuery(start, end);
								setError(undefined);
								onChange(query);
							} catch {
								setError("请填写有效起止日期，结束日不能早于开始日，且最多90天。");
							}
						}}
					>
						应用日期
					</Button>
				</div>
			) : null}
			<p className="text-xs text-muted-foreground">{TIME_SCOPE[scope].label} · 北京时间</p>
			{error || timeError ? (
				<p role="alert" className="text-sm text-danger">
					{error ?? timeError}
				</p>
			) : null}
		</div>
	);
}

export function TimeRangeSummary({ filters }: { filters: TimeFilters }) {
	return filters.from && filters.to ? (
		<p className="my-2 text-xs text-muted-foreground">
			查询区间：{formatTimestamp(filters.from)} 至 {formatTimestamp(filters.to)}（不含结束时刻）
		</p>
	) : null;
}

function inputDate(value: string | undefined, exclusiveEnd = false) {
	if (!(value && Number.isFinite(Date.parse(value)))) {
		return "";
	}
	return beijingDate(new Date(Date.parse(value) - (exclusiveEnd ? 1 : 0)).toISOString());
}
