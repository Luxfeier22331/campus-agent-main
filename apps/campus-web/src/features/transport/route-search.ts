import { TransportDateSchema, type TransportServiceKind } from "@campus-agent/transport/domain";

export interface TransportSearch {
	date?: string;
	serviceKind?: TransportServiceKind;
	routeId?: string;
	rider?: "all" | "student" | "teacher";
}

export function parseTransportSearch(search: Record<string, unknown>): TransportSearch {
	return {
		...(TransportDateSchema.safeParse(search.date).success ? { date: search.date as string } : {}),
		...(search.serviceKind === "commute" ||
		search.serviceKind === "subway" ||
		search.serviceKind === "special"
			? { serviceKind: search.serviceKind }
			: {}),
		...(typeof search.routeId === "string" && search.routeId ? { routeId: search.routeId } : {}),
		...(search.rider === "all" || search.rider === "student" || search.rider === "teacher"
			? { rider: search.rider }
			: {}),
	};
}

export function transportReturnTarget(value: unknown): string | undefined {
	if (typeof value !== "string" || !/^\/transport(?:\?|$)/u.test(value)) {
		return undefined;
	}
	const url = new URL(value, "https://campus.local");
	const search = parseTransportSearch(Object.fromEntries(url.searchParams));
	const query = new URLSearchParams(search as Record<string, string>).toString();
	return `/transport${query ? `?${query}` : ""}`;
}
