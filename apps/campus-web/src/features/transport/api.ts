import {
	type TransportPublicScheduleResponse,
	TransportPublicScheduleResponseSchema,
} from "@campus-agent/transport/domain";
import { requestJson } from "@/platform/api/client";

export type TransportScheduleResponse = TransportPublicScheduleResponse;
export type {
	TransportPublicDeparture,
	TransportPublicRoute,
} from "@campus-agent/transport/domain";

export async function getTransportSchedule(date: string, input: { signal?: AbortSignal } = {}) {
	const payload = await requestJson<unknown>({
		path: `/api/transport/schedule?date=${encodeURIComponent(date)}`,
		...(input.signal ? { signal: input.signal } : {}),
	});
	return TransportPublicScheduleResponseSchema.parse(payload);
}
