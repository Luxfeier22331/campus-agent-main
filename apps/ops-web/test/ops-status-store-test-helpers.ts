import {
	decodeRequestCursor,
	requestAttentionPriority,
	requestListView,
} from "../src/server/ops-status-mappers";
import type {
	OpsAgentUsageRow,
	OpsRequestDetailRow,
	OpsRequestListQuery,
	OpsRequestRow,
	PgOpsStatusStoreDatabase,
} from "../src/server/ops-status-store";
import { OPS_REQUEST_PAGE_SIZE } from "../src/server/ops-status-store";

export function createFakeOpsDb(
	overrides: { requestRows?: OpsRequestDetailRow[]; usageRows?: OpsAgentUsageRow[] } = {},
): PgOpsStatusStoreDatabase {
	const requestRows = overrides.requestRows ?? [requestRow()];
	const usageRows = overrides.usageRows ?? [agentUsageRow()];

	return {
		async getAgentUsages(runIds) {
			const runIdSet = new Set(runIds);
			return usageRows.filter((row) => runIdSet.has(row.runId));
		},
		async getRequestOverview(since) {
			const visible = requestRows.filter((row) => row.startedAt >= since);
			const summary = summarizeRows(visible);
			const durations = visible
				.map((row) => row.durationMs)
				.filter((value): value is number => value !== null)
				.sort((left, right) => left - right);
			return {
				...summary,
				latestProjectedAt:
					visible.map((row) => row.dataUpdatedAt).sort((a, b) => b.valueOf() - a.valueOf())[0] ??
					null,
				p95DurationMs:
					durations.length > 0 ? (durations[Math.ceil(durations.length * 0.95) - 1] ?? null) : null,
			};
		},
		async getRequest(requestId) {
			return requestRows.find((row) => row.requestId === requestId) ?? null;
		},
		async getRequestTrends(since) {
			const visible = requestRows.filter((row) => row.startedAt >= since);
			return visible.length === 0
				? []
				: [
						{
							bucketStart: since,
							...summarizeRows(visible),
							p95DurationMs: visible[0]?.durationMs ?? null,
						},
					];
		},
		async listRequests(query, since) {
			const view = requestListView(query);
			const filtered = filterRequestRows(requestRows, query, since).sort((left, right) => {
				const priority =
					view === "attention"
						? requestAttentionPriority(validAttentionReason(left.attentionReason)) -
							requestAttentionPriority(validAttentionReason(right.attentionReason))
						: 0;
				return (
					priority ||
					right.startedAt.valueOf() - left.startedAt.valueOf() ||
					(right.requestId === left.requestId ? 0 : right.requestId < left.requestId ? -1 : 1)
				);
			});
			const cursor = decodeRequestCursor(query.cursor, view);
			const visible = cursor
				? filtered.filter((row) => {
						const followsTimestamp =
							row.startedAt.toISOString() < cursor.startedAt ||
							(row.startedAt.toISOString() === cursor.startedAt &&
								row.requestId < cursor.requestId);
						return cursor.view === "recent"
							? followsTimestamp
							: requestAttentionPriority(validAttentionReason(row.attentionReason)) >
									cursor.priority ||
									(requestAttentionPriority(validAttentionReason(row.attentionReason)) ===
										cursor.priority &&
										followsTimestamp);
					})
				: filtered;
			return visible.slice(0, OPS_REQUEST_PAGE_SIZE + 1);
		},
		async summarizeRequests(query, since) {
			return summarizeRows(filterRequestRows(requestRows, query, since));
		},
		async verifyReadiness() {
			return;
		},
		async verifySchema() {
			return;
		},
	};
}

function validAttentionReason(
	value: string | null,
): "REQUEST_FAILED" | "RESULT_MISSING" | "WAITING_USER" | null {
	if (
		value === null ||
		value === "REQUEST_FAILED" ||
		value === "RESULT_MISSING" ||
		value === "WAITING_USER"
	) {
		return value;
	}
	throw new Error(`invalid attention reason: ${value}`);
}

export function requestRow(overrides: Partial<OpsRequestDetailRow> = {}): OpsRequestDetailRow {
	return {
		admissionStatus: "accepted",
		assistantKind: "answer",
		assistantMessagePresent: true,
		assistantMessageText: "缓考申请需提交书面材料。",
		assistantStructuredPartsJson: [
			{
				sourceItems: [
					{
						collectionLabel: "学生规定",
						pageLabel: "运行状态",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/documents/student-rules",
							label: "查看学生规定",
						},
						publisherLabel: "校园服务中心",
						sectionTitle: "缓考申请",
						snippet: "申请人需提交书面材料。",
						title: "学生管理规定",
						versionLabel: "当前版本",
					},
				],
				type: "source_items",
			},
		],
		attentionPriority: null,
		attentionReason: null,
		completedAt: new Date("2026-07-09T07:29:04.000Z"),
		conversationId: "conv_pg_001",
		dataUpdatedAt: new Date("2026-07-09T07:29:05.000Z"),
		durationMs: 4_200,
		errorCode: null,
		questionPreview: "缓考申请需要哪些材料？",
		questionText: "缓考申请需要哪些材料？",
		questionTruncated: false,
		requestId: "req_pg_001",
		runId: "run_pg_001",
		runStatus: "completed",
		runtimeVersionsJson: { agentRuntime: "openai_agents_sdk" },
		startedAt: new Date("2026-07-09T07:29:00.000Z"),
		status: "completed",
		surface: "campus_web",
		terminalReason: "answer",
		traceId: "trace_pg_001",
		turnSequence: 3,
		workflowId: "campus-agent.chat.run_pg_001",
		...overrides,
	};
}

export function agentUsageRow(overrides: Partial<OpsAgentUsageRow> = {}): OpsAgentUsageRow {
	return {
		cachedInputTokens: 200,
		inputTokens: 1_200,
		observedAttemptCount: 1,
		outputTokens: 240,
		runId: "run_pg_001",
		totalAttemptCount: 1,
		...overrides,
	};
}

function filterRequestRows(
	rows: OpsRequestDetailRow[],
	query: OpsRequestListQuery,
	since: Date,
): OpsRequestDetailRow[] {
	return rows
		.filter((row) => row.startedAt >= since)
		.filter((row) => {
			if (requestListView(query) === "attention" && row.attentionReason === null) {
				return false;
			}
			if (query.status) {
				const statuses = {
					ACTION_REQUIRED: ["approval_required", "needs_clarification"],
					CANCELLED: ["cancelled"],
					COMPLETED: ["completed"],
					FAILED: ["error", "rejected", "no_answer"],
					PENDING: ["accepted"],
					RUNNING: ["running"],
				}[query.status];
				if (!statuses.includes(row.status)) {
					return false;
				}
			}
			if (query.conversationId && row.conversationId !== query.conversationId) {
				return false;
			}
			if (query.requestId && row.requestId !== query.requestId) {
				return false;
			}
			if (query.runId && row.runId !== query.runId) {
				return false;
			}
			if (query.traceId && row.traceId !== query.traceId) {
				return false;
			}
			if (query.workflowId && row.workflowId !== query.workflowId) {
				return false;
			}
			if (query.q) {
				const text = [
					row.conversationId,
					row.errorCode,
					row.questionPreview,
					row.requestId,
					row.runId,
					row.traceId,
					row.workflowId,
				].join(" ");
				if (!text.toLowerCase().includes(query.q.toLowerCase())) {
					return false;
				}
			}
			return true;
		});
}

function summarizeRows(rows: OpsRequestRow[]) {
	const summary = {
		actionRequired: 0,
		cancelled: 0,
		completed: 0,
		failed: 0,
		pending: 0,
		running: 0,
		total: 0,
	};
	for (const row of rows) {
		if (row.status === "completed") {
			summary.completed += 1;
		} else if (row.status === "cancelled") {
			summary.cancelled += 1;
		} else if (["error", "rejected", "no_answer"].includes(row.status)) {
			summary.failed += 1;
		} else if (["approval_required", "needs_clarification"].includes(row.status)) {
			summary.actionRequired += 1;
		} else if (row.status === "accepted") {
			summary.pending += 1;
		} else {
			summary.running += 1;
		}
		summary.total += 1;
	}
	return summary;
}
