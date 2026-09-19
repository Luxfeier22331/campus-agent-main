import { type TimeQuery, timeQuerySchema } from "campus-contracts/ops-time";

export interface TimeSearch extends TimeQuery {
	timeError?: string | undefined;
}

export function timeQueryFields(search: TimeQuery): TimeQuery {
	return { window: search.window, from: search.from, to: search.to };
}

export function readTimeSearch(search: Record<string, unknown>): TimeSearch {
	const result = timeQuerySchema("overview").safeParse({
		window: search.window,
		from: search.from,
		to: search.to,
	});
	if (!result.success) {
		return {
			...(Object.fromEntries(
				["window", "from", "to"]
					.filter((key) => search[key] !== undefined)
					.map((key) => [key, String(search[key])]),
			) as TimeQuery),
			timeError: "时间范围无效，请重新选择有效区间（最多90天）。",
		};
	}
	return result.data.from ? result.data : { window: result.data.window ?? "today" };
}

export function replaceTimeQuery<
	T extends TimeSearch & { cursor?: string | undefined; history?: string | undefined },
>(search: T, query: TimeQuery) {
	const {
		window: _window,
		from: _from,
		to: _to,
		timeError: _error,
		cursor: _cursor,
		history: _history,
		...filters
	} = search;
	return { ...filters, ...query };
}
