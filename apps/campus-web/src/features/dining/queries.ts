import type { DiningReviewPage } from "@campus-agent/dining/domain";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { getDiningMap, getDiningReviews, getDiningWindowMenu } from "./api";
import { loadDiningFloorplanAsset } from "./floorplan-asset";

export const diningQueryKeys = {
	map: ["dining", "map"] as const,
	menu: (windowId: string) => ["dining", "menu", windowId] as const,
	reviews: (menuItemId: string) => ["dining", "reviews", menuItemId] as const,
	floorplan: (floorplanId: string, sha256: string) =>
		["dining", "floorplan", floorplanId, sha256] as const,
};

export function diningMapQueryOptions() {
	return queryOptions({
		queryFn: ({ signal }) => getDiningMap({ signal }),
		queryKey: diningQueryKeys.map,
		staleTime: 5 * 60_000,
	});
}

export function diningWindowMenuQueryOptions(windowId: string) {
	return queryOptions({
		queryFn: ({ signal }) => getDiningWindowMenu(windowId, { signal }),
		queryKey: diningQueryKeys.menu(windowId),
		staleTime: 60_000,
	});
}

export function diningReviewsInfiniteQueryOptions(
	menuItemId: string,
	viewerId: string | null,
	enabled: boolean,
) {
	return infiniteQueryOptions({
		enabled,
		getNextPageParam: (lastPage: DiningReviewPage) => lastPage.nextCursor ?? undefined,
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) => getDiningReviews({ cursor: pageParam, menuItemId, signal }),
		queryKey: [...diningQueryKeys.reviews(menuItemId), viewerId] as const,
	});
}

export function diningFloorplanAssetQueryOptions(input: {
	floorplanId: string;
	sha256: string;
	svgAssetUrl: string;
}) {
	return queryOptions({
		queryFn: ({ signal }) => loadDiningFloorplanAsset({ ...input, signal }),
		queryKey: diningQueryKeys.floorplan(input.floorplanId, input.sha256),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
