// This module is shared by the browser and edge cache. Keep it free of schema/runtime imports.
export function transportScheduleUrl(date: string, includeNotices = true): string {
	return `/api/transport/schedule?${new URLSearchParams({ date, ...(includeNotices ? { include: "notices" } : {}) })}`;
}

export function transportScheduleRangeUrl(from: string, to: string, includeNotices = true): string {
	return `/api/transport/schedule-range?${new URLSearchParams({ from, to, ...(includeNotices ? { include: "notices" } : {}) })}`;
}

export function normalizeTransportPublicSearch(url: URL): string | null {
	const range = url.pathname === "/api/transport/schedule-range";
	if (!range && url.pathname !== "/api/transport/schedule") {
		return null;
	}
	const names = range ? ["from", "to"] : ["date"];
	const include = url.searchParams.get("include");
	if (include !== null && include !== "notices") {
		return null;
	}
	if (url.searchParams.size !== names.length + (include === null ? 0 : 1)) {
		return null;
	}
	const allowed = new Set([...names, "include"]);
	for (const name of url.searchParams.keys()) {
		if (!allowed.has(name) || url.searchParams.getAll(name).length !== 1) {
			return null;
		}
	}
	const normalized = new URLSearchParams();
	for (const name of names) {
		const value = url.searchParams.get(name) ?? "";
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
			return null;
		}
		const timestamp = Date.parse(`${value}T00:00:00Z`);
		if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
			return null;
		}
		normalized.set(name, value);
	}
	if (range) {
		const days =
			(Date.parse(normalized.get("to") ?? "") - Date.parse(normalized.get("from") ?? "")) /
			86_400_000;
		if (days < 0 || days > 30) {
			return null;
		}
	}
	if (include) {
		normalized.set("include", include);
	}
	return `?${normalized}`;
}
