import { Button, Field, Input, StateMessage } from "@campus-agent/ui";
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
import { FilterSelect } from "./filter-select";

export function timeWindowOptions(_scope: TimeScope): Array<{ label: string; value: TimeWindow }> {
	return TIME_WINDOWS.map((value) => ({ label: TIME_WINDOW_LABELS[value], value }));
}

export function TimeRangeFilter({
	search,
	scope,
	onChange,
	allowAll = false,
	label,
}: {
	search: TimeSearch;
	scope: TimeScope;
	allowAll?: boolean;
	label?: string;
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
		<div className="ops-time-range min-w-0 grid gap-2">
			<Field
				label={
					<span>
						{label ?? TIME_SCOPE[scope].label}{" "}
						<span className="text-xs font-normal leading-none text-muted-foreground">
							· 北京时间
						</span>
					</span>
				}
			>
				<FilterSelect
					aria-label="时间范围"
					value={custom ? "custom" : (window ?? (allowAll ? "all" : "today"))}
					onValueChange={(value) => {
						setError(undefined);
						if (value === "custom") {
							setCustom(true);
							return;
						}
						setCustom(false);
						onChange(value === "all" ? {} : { window: value as TimeWindow });
					}}
					options={[
						...(allowAll ? [{ value: "all", label: "全部时间" }] : []),
						...timeWindowOptions(scope),
						{ value: "custom", label: "选择日期" },
					]}
				/>
			</Field>
			{custom ? (
				<div className="flex flex-wrap items-end gap-2">
					<Field label="开始日期">
						<Input
							id="time-start"
							aria-label="开始日期"
							type="date"
							value={start}
							onChange={(event) => setStart(event.target.value)}
						/>
					</Field>
					<Field label="结束日期">
						<Input
							id="time-end"
							aria-label="结束日期"
							type="date"
							value={end}
							onChange={(event) => setEnd(event.target.value)}
						/>
					</Field>
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
			{error || timeError ? (
				<StateMessage layout="inline" role="alert" tone="danger" description={error ?? timeError} />
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
