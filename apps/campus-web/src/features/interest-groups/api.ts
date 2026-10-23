import { CampusGroupsCatalogSchema } from "campus-contracts/campus-groups";
import { requestJson } from "@/platform/api/client";
import { type InterestGroupCatalog, toInterestGroupCatalog } from "./model";

export async function getInterestGroupCatalog(
	input: { signal?: AbortSignal } = {},
): Promise<InterestGroupCatalog> {
	const payload = await requestJson<unknown>({
		path: "/api/campus-groups/catalog",
		...(input.signal ? { signal: input.signal } : {}),
	});
	return toInterestGroupCatalog(CampusGroupsCatalogSchema.parse(payload));
}
