import { queryOptions } from "@tanstack/react-query";
import { getTransportSchedule } from "./api";

export const transportQueryKeys = {
	schedule: (date: string) => ["transport", "schedule", date] as const,
};

export function transportScheduleQueryOptions(date: string) {
	return queryOptions({
		queryKey: transportQueryKeys.schedule(date),
		queryFn: ({ signal }) => getTransportSchedule(date, { signal }),
		staleTime: 60_000,
	});
}
