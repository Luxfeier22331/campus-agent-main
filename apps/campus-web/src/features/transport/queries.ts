import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getTransportSchedule, getTransportScheduleRange } from "./api";

export const transportQueryKeys = {
	schedule: (date: string) => ["transport", "schedule", date] as const,
	scheduleRange: (from: string, to: string) => ["transport", "schedule-range", from, to] as const,
};

export function transportScheduleQueryOptions(date: string) {
	return queryOptions({
		queryKey: transportQueryKeys.schedule(date),
		queryFn: ({ signal }) => getTransportSchedule(date, { signal }),
		placeholderData: keepPreviousData,
		staleTime: 60_000,
	});
}

export function transportScheduleRangeQueryOptions(from: string, to: string) {
	return queryOptions({
		queryKey: transportQueryKeys.scheduleRange(from, to),
		queryFn: ({ signal }) => getTransportScheduleRange(from, to, { signal }),
		staleTime: 60_000,
	});
}
