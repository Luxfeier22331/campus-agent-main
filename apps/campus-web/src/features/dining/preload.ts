import { diningMapQueryOptions } from "./queries";
import { diningQueryClient } from "./query-client";

export async function preloadDiningRoute(): Promise<void> {
	await diningQueryClient.prefetchQuery(diningMapQueryOptions());
}
