import { opsOverviewFixture, opsRequestDetailFixtures } from "../shared/ops-fixtures.ts";
import {
	decodeRequestCursor,
	encodeRequestCursor,
	matchesRequestQuery,
	summarizeRequests,
} from "./ops-status-mappers.ts";
import type { OpsStatusStore } from "./ops-status-store.ts";

export function createFixtureOpsStatusStore(): OpsStatusStore {
	const requestDetails = opsRequestDetailFixtures;
	return {
		async getOverview(_window) {
			return {
				externalLinks: opsOverviewFixture.externalLinks,
				requests: opsOverviewFixture.requests,
				temporal: opsOverviewFixture.temporal,
				trends: opsOverviewFixture.trends,
			};
		},
		async getRequestDetail(requestId) {
			return requestDetails.find((detail) => detail.request.requestId === requestId) ?? null;
		},
		async listRequests(query) {
			const filtered = requestDetails
				.map((detail) => detail.request)
				.filter((request) => matchesRequestQuery(request, query));
			const cursor = decodeRequestCursor(query.cursor);
			const start = cursor
				? filtered.findIndex(
						(request) =>
							request.startedAt === cursor.startedAt && request.requestId === cursor.requestId,
					) + 1
				: 0;
			const data = filtered.slice(Math.max(0, start), Math.max(0, start) + query.limit);
			const lastVisible = data.at(-1);
			return {
				data,
				page: {
					nextCursor:
						Math.max(0, start) + data.length < filtered.length && lastVisible
							? encodeRequestCursor(lastVisible)
							: null,
				},
				summary: summarizeRequests(filtered),
				window: query.window,
			};
		},
		async verifyReadiness() {
			return;
		},
	};
}
