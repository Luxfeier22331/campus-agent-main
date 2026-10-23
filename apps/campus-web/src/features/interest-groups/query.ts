import { queryOptions } from "@tanstack/react-query";
import { getInterestGroupCatalog } from "./api";

export const interestGroupCatalogQueryOptions = () =>
	queryOptions({
		queryFn: ({ signal }) => getInterestGroupCatalog({ signal }),
		queryKey: ["campus-groups", "catalog"] as const,
	});
