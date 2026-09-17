import type {
	DiningMySubmissionPage,
	DiningSubmissionPage,
	DiningSubmissionReviewPage,
} from "@campus-agent/dining/domain";
import { infiniteQueryOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import {
	getDiningSubmission,
	getDiningSubmissionReviews,
	getDiningSubmissions,
	getMyDiningSubmission,
	getMyDiningSubmissions,
} from "./submission-api";

export const diningSubmissionQueryKeys = {
	all: ["dining", "submissions"] as const,
	list: (windowId: string) => ["dining", "submissions", "window", windowId] as const,
	detail: (submissionId: string) => ["dining", "submissions", "detail", submissionId] as const,
	mine: (viewerId: string | null) => ["dining", "submissions", "mine", viewerId] as const,
	ownDetail: (submissionId: string, viewerId: string | null) =>
		["dining", "submissions", "own", viewerId, submissionId] as const,
	reviews: (submissionId: string) => ["dining", "submissions", "reviews", submissionId] as const,
};

export function diningSubmissionsInfiniteQueryOptions(
	windowId: string,
	viewerId: string | null,
	enabled = true,
) {
	return infiniteQueryOptions({
		enabled: enabled && Boolean(windowId),
		getNextPageParam: (page: DiningSubmissionPage) => page.nextCursor ?? undefined,
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) =>
			getDiningSubmissions({ windowId, cursor: pageParam, signal }),
		queryKey: [...diningSubmissionQueryKeys.list(windowId), viewerId] as const,
		staleTime: 0,
	});
}

export function diningSubmissionQueryOptions(
	submissionId: string,
	viewerId: string | null,
	enabled = true,
) {
	return queryOptions({
		enabled: enabled && Boolean(submissionId),
		queryFn: ({ signal }) => getDiningSubmission(submissionId, { signal }),
		queryKey: [...diningSubmissionQueryKeys.detail(submissionId), viewerId] as const,
		staleTime: 0,
	});
}

export function myDiningSubmissionsInfiniteQueryOptions(viewerId: string | null, enabled = true) {
	return infiniteQueryOptions({
		enabled: enabled && Boolean(viewerId),
		getNextPageParam: (page: DiningMySubmissionPage) => page.nextCursor ?? undefined,
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) => getMyDiningSubmissions({ cursor: pageParam, signal }),
		queryKey: diningSubmissionQueryKeys.mine(viewerId),
		staleTime: 0,
	});
}

export function myDiningSubmissionQueryOptions(
	submissionId: string,
	viewerId: string | null,
	enabled = true,
) {
	return queryOptions({
		enabled: enabled && Boolean(viewerId) && Boolean(submissionId),
		queryFn: ({ signal }) => getMyDiningSubmission(submissionId, { signal }),
		queryKey: diningSubmissionQueryKeys.ownDetail(submissionId, viewerId),
		staleTime: 0,
	});
}

export function diningSubmissionReviewsInfiniteQueryOptions(
	submissionId: string,
	viewerId: string | null,
	enabled = true,
) {
	return infiniteQueryOptions({
		enabled: enabled && Boolean(submissionId),
		getNextPageParam: (page: DiningSubmissionReviewPage) => page.nextCursor ?? undefined,
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) =>
			getDiningSubmissionReviews({ submissionId, cursor: pageParam, signal }),
		queryKey: [...diningSubmissionQueryKeys.reviews(submissionId), viewerId] as const,
		staleTime: 0,
	});
}

export function invalidateDiningSubmissions(client: QueryClient) {
	return client.invalidateQueries({ queryKey: diningSubmissionQueryKeys.all });
}
