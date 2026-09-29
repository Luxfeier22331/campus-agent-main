import {
	TransportPublicScheduleRangeSchema,
	type TransportPublicScheduleResponse,
	TransportPublicScheduleResponseSchema,
} from "@campus-agent/transport/domain";
import {
	transportScheduleRangeUrl,
	transportScheduleUrl,
} from "@campus-agent/transport/public-query";
import { requestJson } from "@/platform/api/client";

export type TransportScheduleResponse = TransportPublicScheduleResponse;
export type {
	TransportPublicDeparture,
	TransportPublicRoute,
} from "@campus-agent/transport/domain";

export async function getTransportSchedule(date: string, input: { signal?: AbortSignal } = {}) {
	const payload = await requestJson<unknown>({
		path: transportScheduleUrl(date),
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
		path: transportScheduleRangeUrl(from, to),
		...(input.signal ? { signal: input.signal } : {}),
	});
	return TransportPublicScheduleRangeSchema.parse(payload);
}
