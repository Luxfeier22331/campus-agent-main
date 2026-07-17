import { getDiningFloorplanAssetById } from "@campus-agent/dining/floorplan-assets";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
	getDiningBootstrap,
	getDiningFloor,
	getDiningOfferingReviews,
	getDiningPublication,
	searchDining,
} from "./api";
import { loadDiningFloorplanAsset } from "./floorplan-asset";
import type {
	DiningBootstrapResponse,
	DiningBootstrapTransportResponse,
	DiningFloorResponse,
	DiningFloorTransportResponse,
} from "./model";

export const diningQueryKeys = {
	bootstrap: ["dining", "bootstrap"] as const,
	publication: ["dining", "publication"] as const,
	floor: (hallId: string, floorId: string) => ["dining", "floor", hallId, floorId] as const,
	floorplan: (floorplanId: string, sha256: string) =>
		["dining", "floorplan", floorplanId, sha256] as const,
	reviews: (offeringId: string) => ["dining", "reviews", offeringId] as const,
	search: (scopeHallId: string, query: string, tag: string | null) =>
		["dining", "search", scopeHallId, query, tag] as const,
};

export function diningPublicationQueryOptions() {
	return queryOptions({
		queryFn: ({ signal }) => getDiningPublication({ signal }),
		queryKey: diningQueryKeys.publication,
		refetchInterval: () =>
			typeof document === "undefined" || document.visibilityState === "visible" ? 30_000 : false,
		refetchIntervalInBackground: false,
		staleTime: 0,
	});
}

export function diningBootstrapQueryOptions() {
	return queryOptions({
		queryFn: async ({ signal }) =>
			validateDiningBootstrap(resolveDiningBootstrap(await getDiningBootstrap({ signal }))),
		queryKey: diningQueryKeys.bootstrap,
		staleTime: 60_000,
	});
}

function validateDiningBootstrap(payload: DiningBootstrapResponse): DiningBootstrapResponse {
	const initialHall = payload.halls[0];
	if (!initialHall) {
		if (payload.initial) {
			throw new Error("Dining bootstrap contains initial data without a published hall.");
		}
		return payload;
	}
	const initialFloorId = initialHall.floors[0]?.floorId;
	if (
		!(payload.initial && initialFloorId) ||
		payload.initial.floor.floor.hallId !== initialHall.hallId ||
		payload.initial.floor.floor.floorId !== initialFloorId
	) {
		throw new Error("Dining bootstrap does not match its initial published selection.");
	}
	return payload;
}

export function diningFloorQueryOptions(input: {
	floorId: string;
	hallId: string;
	initialData?: DiningFloorResponse;
	initialDataUpdatedAt?: number;
}) {
	return queryOptions({
		enabled: Boolean(input.floorId && input.hallId),
		initialData: input.initialData,
		initialDataUpdatedAt: input.initialDataUpdatedAt,
		queryFn: async ({ signal }) => {
			const payload = resolveDiningFloor(await getDiningFloor({ ...input, signal }));
			if (payload.floor.hallId !== input.hallId || payload.floor.floorId !== input.floorId) {
				throw new Error("Dining floor response does not match the requested selection.");
			}
			return payload;
		},
		queryKey: diningQueryKeys.floor(input.hallId, input.floorId),
		staleTime: 60_000,
	});
}

export function diningReviewsQueryOptions(input: { offeringId: string }) {
	return queryOptions({
		enabled: Boolean(input.offeringId),
		queryFn: async ({ signal }) => {
			const payload = await getDiningOfferingReviews({
				offeringId: input.offeringId,
				signal,
			});
			if (payload.offeringId !== input.offeringId) {
				throw new Error("Dining review response does not match the requested offering.");
			}
			return payload;
		},
		queryKey: diningQueryKeys.reviews(input.offeringId),
		staleTime: 60_000,
	});
}

export function diningSearchQueryOptions(input: {
	query: string;
	scopeHallId: string;
	tag: string | null;
}) {
	const normalizedQuery = input.query.trim();
	return queryOptions({
		enabled: Boolean(input.scopeHallId && (normalizedQuery || input.tag)),
		queryFn: async ({ signal }) => {
			const payload = await searchDining({ ...input, query: normalizedQuery, signal });
			if (payload.scope.hallId !== input.scopeHallId) {
				throw new Error("Dining search response does not match the requested scope.");
			}
			return payload;
		},
		queryKey: diningQueryKeys.search(input.scopeHallId, normalizedQuery, input.tag),
		staleTime: 60_000,
	});
}

export function diningFloorplanAssetQueryOptions(input: {
	floorplanId: string;
	sha256: string;
	svgAssetUrl: string;
}) {
	return queryOptions({
		queryFn: () => loadDiningFloorplanAsset(input),
		queryKey: diningQueryKeys.floorplan(input.floorplanId, input.sha256),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export async function prefetchDiningFloor(
	queryClient: QueryClient,
	input: { floorId: string; hallId: string },
): Promise<void> {
	const floorOptions = diningFloorQueryOptions(input);
	await queryClient.prefetchQuery(floorOptions);
	const floor = queryClient.getQueryData<DiningFloorResponse>(floorOptions.queryKey);
	if (floor?.floor.floorplan.kind !== "asset") {
		return;
	}
	await queryClient.prefetchQuery(
		diningFloorplanAssetQueryOptions({
			floorplanId: floor.floor.floorplan.floorplanId,
			sha256: floor.floor.floorplan.sha256,
			svgAssetUrl: floor.floor.floorplan.svgAssetUrl,
		}),
	);
}

export function resolveDiningFloor(payload: DiningFloorTransportResponse): DiningFloorResponse {
	if (payload.floor.floorplan.kind === "placeholder") {
		return {
			...payload,
			floor: {
				...payload.floor,
				floorplan: {
					anchorInventory: [],
					canvas: placeholderCanvas(payload.windows.length),
					floorplanId: payload.floor.floorplan.floorplanId,
					kind: "placeholder",
				},
			},
		};
	}
	if (payload.floor.floorplan.kind !== "asset") {
		return unavailableDiningFloor(payload);
	}
	let asset: ReturnType<typeof getDiningFloorplanAssetById>;
	try {
		asset = getDiningFloorplanAssetById(payload.floor.floorplan.floorplanId);
	} catch {
		return unavailableDiningFloor(payload);
	}
	if (asset.floorId !== payload.floor.floorId || asset.hallId !== payload.floor.hallId) {
		return unavailableDiningFloor(payload);
	}
	return {
		...payload,
		floor: {
			...payload.floor,
			floorplan: { ...asset, kind: "asset" },
		},
	};
}

function unavailableDiningFloor(payload: DiningFloorTransportResponse): DiningFloorResponse {
	return {
		...payload,
		floor: {
			...payload.floor,
			floorplan: {
				anchorInventory: [],
				canvas: { height: 760, width: 1280 },
				floorplanId: payload.floor.floorplan.floorplanId,
				kind: "unavailable",
			},
		},
	};
}

function resolveDiningBootstrap(
	payload: DiningBootstrapTransportResponse,
): DiningBootstrapResponse {
	return {
		...payload,
		initial: payload.initial ? { floor: resolveDiningFloor(payload.initial.floor) } : null,
	};
}

function placeholderCanvas(windowCount: number): { height: number; width: number } {
	const rows = Math.max(1, Math.ceil(windowCount / 3));
	return { height: Math.max(420, 120 + rows * 112), width: 720 };
}
