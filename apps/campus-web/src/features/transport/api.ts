import {
	type TransportPublicScheduleRange,
	TransportPublicScheduleRangeSchema,
	type TransportPublicScheduleResponse,
	TransportPublicScheduleResponseSchema,
} from "@campus-agent/transport/domain";
import { requestJson } from "@/platform/api/client";

export type TransportScheduleResponse = TransportPublicScheduleResponse;
export type TransportScheduleRangeResponse = TransportPublicScheduleRange;
export type {
	TransportPublicDeparture,
	TransportPublicRoute,
} from "@campus-agent/transport/domain";

export async function getTransportSchedule(date: string, input: { signal?: AbortSignal } = {}) {
	const payload = await requestJson<unknown>({
		path: `/api/transport/schedule?date=${encodeURIComponent(date)}&include=notices`,
		...(input.signal ? { signal: input.signal } : {}),
	});
	return TransportPublicScheduleResponseSchema.parse(payload);
}

export async function getTransportScheduleRange(
	from: string,
	to: string,
	input: { signal?: AbortSignal } = {},
) {
	const payload = await requestJson<unknown>({
		path: `/api/transport/schedule-range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&include=notices`,
		...(input.signal ? { signal: input.signal } : {}),
	});
	return TransportPublicScheduleRangeSchema.parse(payload);
}
