import {
	NoticeTransportPeriodsResponseSchema,
	type TransportNoticeLinkInput,
	TransportNoticeLinksInputSchema,
	TransportNoticeLinksResponseSchema,
	type TransportOpsRouteCreate,
	TransportOpsRouteCreateSchema,
	TransportOpsRouteResponseSchema,
	TransportOpsRoutesResponseSchema,
	type TransportOpsRouteUpdate,
	TransportOpsRouteUpdateSchema,
	type TransportOpsSchedulePeriodCreate,
	TransportOpsSchedulePeriodCreateSchema,
	type TransportOpsSchedulePeriodInput,
	TransportOpsSchedulePeriodInputSchema,
	TransportOpsSchedulePeriodResponseSchema,
	TransportOpsSchedulePeriodsResponseSchema,
} from "../../server/transport-store-contract";
import { fetchJson } from "./core";

export async function fetchTransportRoutes(input: { signal?: AbortSignal } = {}) {
	return TransportOpsRoutesResponseSchema.parse(
		await fetchJson("/api/ops/transport/routes", { signal: input.signal }),
	);
}

export async function createTransportRoute(input: TransportOpsRouteCreate) {
	TransportOpsRouteCreateSchema.parse(input);
	return TransportOpsRouteResponseSchema.parse(
		await fetchJson("/api/ops/transport/routes", {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function updateTransportRoute(routeId: string, input: TransportOpsRouteUpdate) {
	TransportOpsRouteUpdateSchema.parse(input);
	return TransportOpsRouteResponseSchema.parse(
		await fetchJson(`/api/ops/transport/routes/${encodeURIComponent(routeId)}`, {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "PATCH",
		}),
	);
}

export async function deleteTransportRoute(routeId: string) {
	await fetchJson(`/api/ops/transport/routes/${encodeURIComponent(routeId)}`, { method: "DELETE" });
}

export async function fetchTransportSchedulePeriods(input: { signal?: AbortSignal } = {}) {
	return TransportOpsSchedulePeriodsResponseSchema.parse(
		await fetchJson("/api/ops/transport/schedule-periods", { signal: input.signal }),
	);
}

export async function createTransportSchedulePeriod(input: TransportOpsSchedulePeriodCreate) {
	TransportOpsSchedulePeriodCreateSchema.parse(input);
	return TransportOpsSchedulePeriodResponseSchema.parse(
		await fetchJson("/api/ops/transport/schedule-periods", {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function fetchTransportNoticeLinks(scheduleId: string, signal?: AbortSignal) {
	return TransportNoticeLinksResponseSchema.parse(
		await fetchJson(
			`/api/ops/transport/schedule-periods/${encodeURIComponent(scheduleId)}/notices`,
			{ signal },
		),
	);
}
export async function saveTransportNoticeLinks(
	scheduleId: string,
	noticeLinks: TransportNoticeLinkInput[],
) {
	const body = TransportNoticeLinksInputSchema.parse({ noticeLinks });
	return TransportNoticeLinksResponseSchema.parse(
		await fetchJson(
			`/api/ops/transport/schedule-periods/${encodeURIComponent(scheduleId)}/notices`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
		),
	);
}
export async function fetchNoticeTransportPeriods(noticeId: number, signal?: AbortSignal) {
	return NoticeTransportPeriodsResponseSchema.parse(
		await fetchJson(`/api/ops/notices/${noticeId}/transport-schedule-periods`, { signal }),
	);
}

export async function updateTransportSchedulePeriod(
	scheduleId: string,
	input: TransportOpsSchedulePeriodInput,
) {
	TransportOpsSchedulePeriodInputSchema.parse(input);
	return TransportOpsSchedulePeriodResponseSchema.parse(
		await fetchJson(`/api/ops/transport/schedule-periods/${encodeURIComponent(scheduleId)}`, {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "PATCH",
		}),
	);
}

export async function deleteTransportSchedulePeriod(scheduleId: string) {
	await fetchJson(`/api/ops/transport/schedule-periods/${encodeURIComponent(scheduleId)}`, {
		method: "DELETE",
	});
}
