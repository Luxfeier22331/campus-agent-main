import { resolveTimeQuery, timeQueryWindow } from "campus-contracts/ops-time";
import {
	opsOverviewFixture,
	opsRequestDetailFixtures,
	opsRequestListFixture,
} from "../../../shared/ops-fixtures.ts";
import type { OpsStatusStore } from "../contract.ts";
import {
	compareRequestsForView,
	decodeRequestCursor,
	encodeRequestCursor,
	matchesRequestQuery,
	requestAttentionPriority,
	requestListView,
	summarizeRequests,
	withMatchedFailure,
} from "../mapping/request.ts";
import { OPS_REQUEST_PAGE_SIZE } from "./types.ts";

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
			const matched = requests.map((request) =>
				withMatchedFailure(
					request,
					requestDetails.find((detail) => detail.request.requestId === request.requestId),
					query,
				),
			);
			const filtered = matched
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
					matched.filter((request) =>
						matchesRequestQuery(
							request,
							(({ cursor: _cursor, status: _status, ...summaryQuery }) => summaryQuery)(query),
						),
					),
				),
				view,
				window: timeQueryWindow(query),
				filters: query.requestId
					? { from: null, to: null }
					: resolveTimeQuery(query, "requests", new Date(opsRequestListFixture.generatedAt)),
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
