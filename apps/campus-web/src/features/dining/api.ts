import { requestJson } from "@/platform/api/client";
import type {
	DiningBootstrapTransportResponse,
	DiningFloorTransportResponse,
	DiningOfferingReviewsResponse,
	DiningPublication,
	DiningSearchResponse,
} from "./model";

export async function getDiningPublication(
	input: { signal?: AbortSignal } = {},
): Promise<DiningPublication> {
	return requestJson<DiningPublication>({ path: "/api/dining/publication", signal: input.signal });
}

export async function getDiningBootstrap(
	input: { signal?: AbortSignal } = {},
): Promise<DiningBootstrapTransportResponse> {
	return requestJson<DiningBootstrapTransportResponse>({
		path: "/api/dining/bootstrap",
		signal: input.signal,
	});
}

export async function getDiningFloor(input: {
	floorId: string;
	hallId: string;
	signal?: AbortSignal;
}): Promise<DiningFloorTransportResponse> {
	return requestJson<DiningFloorTransportResponse>({
		path: `/api/dining/halls/${encodeURIComponent(input.hallId)}/floors/${encodeURIComponent(
			input.floorId,
		)}`,
		signal: input.signal,
	});
}

export async function getDiningOfferingReviews(input: {
	offeringId: string;
	signal?: AbortSignal;
}): Promise<DiningOfferingReviewsResponse> {
	return requestJson<DiningOfferingReviewsResponse>({
		path: `/api/dining/offerings/${encodeURIComponent(input.offeringId)}/reviews`,
		signal: input.signal,
	});
}

export async function searchDining(input: {
	query: string;
	scopeHallId: string;
	signal?: AbortSignal;
	tag: string | null;
}): Promise<DiningSearchResponse> {
	const params = new URLSearchParams({ scopeHallId: input.scopeHallId });
	if (input.query.trim()) {
		params.set("q", input.query.trim());
	}
	if (input.tag) {
		params.set("tag", input.tag);
	}
	return requestJson<DiningSearchResponse>({
		path: `/api/dining/search?${params.toString()}`,
		signal: input.signal,
	});
}
