import { interestGroupCatalogQueryOptions } from "./query";
import { interestGroupQueryClient } from "./query-client";

export async function preloadInterestGroupsRoute(): Promise<void> {
	await interestGroupQueryClient
		.prefetchQuery(interestGroupCatalogQueryOptions())
		.catch(() => undefined);
}
