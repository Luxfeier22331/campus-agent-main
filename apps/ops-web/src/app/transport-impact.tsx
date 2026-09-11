import {
	selectTransportPeriod,
	shiftTransportDate,
	transportDateRange,
	transportRiderLabel,
} from "@campus-agent/transport/domain";
import { Button, Disclosure, DisclosureSummary, Input } from "@campus-agent/ui";
import { useState } from "react";
import type {
	TransportOpsRoute,
	TransportOpsSchedulePeriod,
	TransportOpsSchedulePeriodInput,
} from "../server/transport-store-contract";

export function previewPeriod(
	value: TransportOpsSchedulePeriodInput,
	source: TransportOpsSchedulePeriod | null,
) {
	return {
		...value,
		scheduleId: source?.scheduleId ?? "preview",
		createdAt: source?.createdAt ?? new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		updatedBy: "preview",
		items: value.items.map((item, index) => ({ ...item, itemId: `preview-${index}` })),
	};
}

export function effectiveDetails(
	period: TransportOpsSchedulePeriod | null,
	route: TransportOpsRoute,
): string[] {
	if (!period) {
		return ["无安排"];
	}
	if (period.status === "suspended") {
		return ["停运", ...(period.note ? [period.note] : [])];
	}
	return [
		...period.items.map((item) =>
			[
				item.kind === "fixed"
					? item.departureTime
					: `${item.firstDepartureTime}–${item.lastDepartureTime} 每${item.intervalMinutes}分钟`,
				transportRiderLabel(item.riderType),
				item.boardingPoint ??
					period.boardingPointOverride ??
					route.defaultBoardingPoint ??
					"乘车点未填写",
				...(item.capacity === null ? [] : [`${item.capacity}人`]),
				...(item.note ? [item.note] : []),
			].join(" · "),
		),
		...(period.note ? [period.note] : []),
	];
}

export interface TransportImpactDay {
	date: string;
	before: string[];
	after: string[];
	added: string[];
	removed: string[];
	changed: boolean;
}

function difference(before: readonly string[], after: readonly string[]) {
	const remaining = new Map<string, number>();
	for (const value of after) {
		remaining.set(value, (remaining.get(value) ?? 0) + 1);
	}
	return before.filter((value) => {
		const count = remaining.get(value) ?? 0;
		if (count > 0) {
			remaining.set(value, count - 1);
			return false;
		}
		return true;
	});
}

export function buildTransportImpactDays(
	from: string,
	to: string,
	periods: readonly TransportOpsSchedulePeriod[],
	afterPeriods: readonly TransportOpsSchedulePeriod[],
	route: TransportOpsRoute,
): TransportImpactDay[] {
	return transportDateRange(from, to).map((date) => {
		const before = effectiveDetails(selectTransportPeriod(periods, date), route);
		const after = effectiveDetails(selectTransportPeriod(afterPeriods, date), route);
		const removed = difference(before, after);
		const added = difference(after, before);
		return { date, before, after, added, removed, changed: added.length > 0 || removed.length > 0 };
	});
}

function sameChange(a: TransportImpactDay, b: TransportImpactDay) {
	return JSON.stringify([a.added, a.removed]) === JSON.stringify([b.added, b.removed]);
}

function groupChangedDays(days: readonly TransportImpactDay[]) {
	const groups: TransportImpactDay[][] = [];
	for (const day of days.filter((item) => item.changed)) {
		const group = groups.at(-1);
		if (
			group &&
			shiftTransportDate(group.at(-1)?.date ?? day.date, 1) === day.date &&
			sameChange(group[0] as TransportImpactDay, day)
		) {
			group.push(day);
		} else {
			groups.push([day]);
		}
	}
	return groups;
}

export function TransportImpact({
	source,
	value,
	route,
	periods,
	effectiveDate,
}: {
	source: TransportOpsSchedulePeriod | null;
	value: TransportOpsSchedulePeriodInput;
	route: TransportOpsRoute;
	periods: readonly TransportOpsSchedulePeriod[];
	effectiveDate?: string;
}) {
	const first = source && source.validFrom < value.validFrom ? source.validFrom : value.validFrom;
	const last =
		value.validTo === null || (source && source.validTo === null)
			? null
			: shiftTransportDate(
					[source?.validTo ?? value.validTo, value.validTo].sort().at(-1) as string,
					1,
				);
	const [requestedStart, setStart] = useState(
		effectiveDate && effectiveDate >= first && (!last || effectiveDate <= last)
			? effectiveDate
			: first,
	);
	const from =
		requestedStart < first ? first : last && requestedStart > last ? last : requestedStart;
	const pageEnd = shiftTransportDate(from, 30);
	const to = last && last < pageEnd ? last : pageEnd;
	const afterPeriods = [
		...periods.filter((period) => period.scheduleId !== source?.scheduleId),
		previewPeriod(value, source),
	];
	const days = buildTransportImpactDays(from, to, periods, afterPeriods, route);
	const changedDays = days.filter((day) => day.changed);
	const groups = groupChangedDays(days);
	return (
		<section aria-label="逐日影响范围" className="grid gap-3 border-t pt-3">
			<h4 className="font-medium">逐日影响范围</h4>
			<p className="text-sm text-muted-foreground">
				当前查看 {from} — {to}，共 {changedDays.length} 天有变化
				{last ? "" : "；长期安排可继续翻页查看"}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={from <= first}
					onClick={() => setStart(shiftTransportDate(from, -31))}
				>
					前31天
				</Button>
				<label className="flex items-center gap-2" htmlFor="transport-impact-date">
					查看日期
					<Input
						id="transport-impact-date"
						aria-label="影响范围查看日期"
						type="date"
						min={first}
						{...(last ? { max: last } : {})}
						value={from}
						onChange={(event) => event.target.value && setStart(event.target.value)}
					/>
				</label>
				<Button
					size="sm"
					variant="outline"
					disabled={last !== null && to >= last}
					onClick={() => setStart(shiftTransportDate(to, 1))}
				>
					后31天
				</Button>
			</div>
			{groups.length > 0 ? (
				<div className="grid gap-2">
					{groups.map((group) => {
						const firstDay = group[0] as TransportImpactDay;
						const lastDay = group.at(-1) as TransportImpactDay;
						return (
							<Disclosure
								key={`${firstDay.date}-${lastDay.date}`}
								className="rounded-[var(--radius-lg)] border p-3"
							>
								<DisclosureSummary className="font-medium">
									{firstDay.date === lastDay.date
										? firstDay.date
										: `${firstDay.date} — ${lastDay.date}`}
								</DisclosureSummary>
								<div className="mt-3 grid gap-3">
									<p className="text-sm text-muted-foreground">
										{group.map((day) => day.date).join("、")}
									</p>
									<div className="grid gap-3 text-sm sm:grid-cols-2">
										<div>
											<p className="font-medium">移除</p>
											<p className="whitespace-pre-line text-muted-foreground">
												{firstDay.removed.length > 0 ? firstDay.removed.join("\n") : "无"}
											</p>
										</div>
										<div>
											<p className="font-medium">新增</p>
											<p className="whitespace-pre-line text-muted-foreground">
												{firstDay.added.length > 0 ? firstDay.added.join("\n") : "无"}
											</p>
										</div>
									</div>
								</div>
							</Disclosure>
						);
					})}
				</div>
			) : (
				<p className="rounded-[var(--radius-lg)] border p-3 text-sm text-muted-foreground">
					当前查看范围没有生效结果变化。
				</p>
			)}
			{days.some((day) => !day.changed) ? (
				<Disclosure className="rounded-[var(--radius-lg)] border p-3 text-sm">
					<DisclosureSummary className="text-muted-foreground">
						显示 {days.filter((day) => !day.changed).length} 天无变化日期
					</DisclosureSummary>
					<p className="mt-3 text-muted-foreground">
						{days
							.filter((day) => !day.changed)
							.map((day) => day.date)
							.join("、")}
					</p>
				</Disclosure>
			) : null}
		</section>
	);
}
