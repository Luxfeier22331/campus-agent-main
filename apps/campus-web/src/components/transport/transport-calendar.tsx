import type { TransportRouteCatalogEntry } from "@campus-agent/transport/domain";
import { Button } from "@campus-agent/ui";
import { parseDate } from "@internationalized/date";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	transportQueryKeys,
	transportScheduleRangeQueryOptions,
} from "@/features/transport/queries";
import { CampusCalendar } from "../ui/calendar";
import type { RiderFilter } from "./transport-page-view";

export function TransportMonthCalendar({
	date,
	routes,
	rider,
	onSelect,
}: {
	date: string;
	routes: readonly TransportRouteCatalogEntry[];
	rider: RiderFilter;
	onSelect: (date: string) => void;
}) {
	const [focus, setFocus] = useState(parseDate(date));
	const from = focus.set({ day: 1 });
	const to = from.add({ months: 1 }).subtract({ days: 1 });
	const query = useQuery(transportScheduleRangeQueryOptions(from.toString(), to.toString()));
	const client = useQueryClient();
	useEffect(() => {
		for (const day of query.data?.days ?? []) {
			const key = transportQueryKeys.schedule(day.date);
			if ((client.getQueryState(key)?.dataUpdatedAt ?? 0) < query.dataUpdatedAt) {
				client.setQueryData(key, day, { updatedAt: query.dataUpdatedAt });
			}
		}
	}, [client, query.data, query.dataUpdatedAt]);
	return (
		<section className="grid gap-2" aria-label="班车月历">
			{routes.length > 0 ? (
				<p className="text-xs text-muted-foreground">
					{routes[0]?.origin} {routes.length === 1 ? "→" : "⇄"} {routes[0]?.destination}
				</p>
			) : null}
			<CampusCalendar
				value={parseDate(date)}
				focusedValue={focus}
				onFocusChange={setFocus}
				onChange={(next) => onSelect(next.toString())}
				renderDay={(day) => {
					const schedule = query.data?.days.find((entry) => entry.date === day.toString());
					const selected = schedule?.routes.filter((entry) =>
						routes.some((choice) => choice.routeId === entry.routeId),
					);
					const count =
						selected
							?.flatMap((entry) => entry.departures)
							.filter(
								(entry) =>
									rider === "all" || entry.riderType === "all" || entry.riderType === rider,
							).length ?? 0;
					const label = schedule
						? selected &&
							selected.length > 0 &&
							selected.every((entry) => entry.status === "suspended")
							? "停运"
							: count
								? `${count}班`
								: "无班次"
						: "";
					return (
						<span className="grid text-center leading-tight">
							<span>{day.day}</span>
							<span className="min-h-3 text-[9px] font-normal">{label}</span>
						</span>
					);
				}}
			/>
			{query.isPending ? (
				<p role="status" className="text-xs text-muted-foreground">
					正在读取月历…
				</p>
			) : null}
			{query.isError ? (
				<div role="alert" className="text-xs text-danger">
					月历读取失败
					<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
						重试月历
					</Button>
				</div>
			) : null}
		</section>
	);
}
