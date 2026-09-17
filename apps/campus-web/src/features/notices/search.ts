import {
	type NoticeListRequestQuery,
	NoticeListRequestQuerySchema,
} from "campus-contracts/notices";

export function parseNoticeRouteSearch(search: Record<string, unknown>): NoticeListRequestQuery {
	const candidate = {
		category: asString(search.category),
		from: asString(search.from),
		is_external: asBooleanString(search.is_external),
		notice_type: asNumberString(search.notice_type),
		organization_id: asString(search.organization_id),
		page: asNumberString(search.page) ?? "1",
		q: asString(search.q),
		stream: asString(search.stream),
		to: asString(search.to),
	};
	if (candidate.page && (!/^\d+$/.test(candidate.page) || Number(candidate.page) < 1)) {
		candidate.page = "1";
	}
	const result = NoticeListRequestQuerySchema.safeParse(candidate);
	return result.success ? result.data : { page: 1, stream: "notices" };
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumberString(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isSafeInteger(value)) {
		return String(value);
	}
	return asString(value);
}

function asBooleanString(value: unknown): string | undefined {
	if (typeof value === "boolean") {
		return String(value);
	}
	return asString(value);
}
