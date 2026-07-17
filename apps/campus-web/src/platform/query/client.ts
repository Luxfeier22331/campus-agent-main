import { QueryClient } from "@tanstack/react-query";

const MINUTE = 60_000;

export function createCampusQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				gcTime: 30 * MINUTE,
				refetchOnWindowFocus: false,
				retry: false,
				staleTime: 5 * MINUTE,
			},
		},
	});
}
