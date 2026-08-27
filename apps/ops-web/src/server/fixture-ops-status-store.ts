import {
	opsOverviewFixture,
	opsRequestDetailFixtures,
	opsRequestListFixture,
} from "../shared/ops-fixtures.ts";
import {
	compareRequestsForView,
	decodeRequestCursor,
	encodeRequestCursor,
	matchesRequestQuery,
	requestAttentionPriority,
	requestListView,
	summarizeRequests,
} from "./ops-status-mappers.ts";
import { OPS_REQUEST_PAGE_SIZE, type OpsStatusStore } from "./ops-status-types.ts";

export function createFixtureOpsStatusStore(): OpsStatusStore {
	const requestDetails = opsRequestDetailFixtures;
	const requests = opsRequestListFixture.data;
	return {
		async getOverview(_window) {
			return {
				requests: opsOverviewFixture.requests,
				trends: opsOverviewFixture.trends,
			};
		},
		async getRequestDetail(requestId) {
			return requestDetails.find((detail) => detail.request.requestId === requestId) ?? null;
		},
		async listRequests(query) {
			const view = requestListView(query);
			const filtered = requests
				.filter((request) => matchesRequestQuery(request, query))
				.sort((left, right) => compareRequestsForView(left, right, view));
			const cursor = decodeRequestCursor(query.cursor, view);
			const start = cursor
				? filtered.findIndex(
						(request) =>
							(cursor.view === "recent" ||
								requestAttentionPriority(request.attentionReason) === cursor.priority) &&
							request.startedAt === cursor.startedAt &&
							request.requestId === cursor.requestId,
					) + 1
				: 0;
			const data = filtered.slice(Math.max(0, start), Math.max(0, start) + OPS_REQUEST_PAGE_SIZE);
			const lastVisible = data.at(-1);
			return {
				data,
				generatedAt: opsRequestListFixture.generatedAt,
				page: {
					nextCursor:
						Math.max(0, start) + data.length < filtered.length && lastVisible
							? encodeRequestCursor(lastVisible, view)
							: null,
				},
				statusCounts: summarizeRequests(
					requests.filter((request) =>
						matchesRequestQuery(
							request,
							(({ cursor: _cursor, status: _status, ...summaryQuery }) => summaryQuery)(query),
						),
					),
				),
				view,
				window: query.window,
			};
		},
		async verifyReadiness() {
			return;
		},
		async verifySchema() {
			return;
		},
	};
}
