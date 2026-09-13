import type { OpsRequestListQuery } from "../src/server/ops-status/contract.ts";
import {
	decodeRequestCursor,
	requestAttentionPriority,
	requestListView,
} from "../src/server/ops-status/mapping/request.ts";
import {
	OPS_REQUEST_PAGE_SIZE,
	type OpsRequestDetailRow,
	type OpsRequestDiagnosticsRows,
	type OpsRequestModelAttemptRow,
	type OpsRequestRow,
	type OpsRequestStageRow,
	type PgOpsStatusStoreDatabase,
} from "../src/server/ops-status/store/types.ts";

export function createFakeOpsDb(
	overrides: { diagnostics?: OpsRequestDiagnosticsRows; requestRows?: OpsRequestDetailRow[] } = {},
): PgOpsStatusStoreDatabase {
	const requestRows = overrides.requestRows ?? [requestRow()];
	const diagnostics = overrides.diagnostics ?? runDiagnostics();

	return {
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
		async getRequestDiagnostics(_requestId) {
			return diagnostics;
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
): "EXECUTION_STAGE_FAILED" | "REQUEST_FAILED" | "RESULT_MISSING" | "WAITING_USER" | null {
	if (
		value === null ||
		value === "EXECUTION_STAGE_FAILED" ||
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
		conversationId: "conv_pg_001",
		userMessageId: "msg_pg_q1",
		assistantMessageId: "msg_pg_a1",
		assistantKind: "answer",
		assistantMessagePresent: true,
		assistantMessageText: "缓考申请需提交书面材料。",
		assistantStructuredPartsJson: [
			{
				sourceItems: [
					{
						citationIndexes: [1],
						collectionLabel: "学生规定",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/docs/regulations/student_rules/student-rules/v/2026#deferred-exam",
							label: "查看文档",
						},
						sectionTitle: "缓考申请",
						snippet: "申请人需提交书面材料。",
						title: "学生管理规定",
						versionSlug: "2026",
					},
				],
				type: "source_items",
			},
		],
		attentionPriority: null,
		attentionReason: null,
		completedAt: new Date("2026-07-09T07:29:04.000Z"),
		dataUpdatedAt: new Date("2026-07-09T07:29:05.000Z"),
		durationMs: 4_200,
		errorCode: null,
		executionFailureKind: null,
		executionStepKind: "agent",
		executionStepStatus: "completed",
		executionStepToolName: null,
		failCloseReason: null,
		questionPreview: "缓考申请需要哪些材料？",
		questionText: "缓考申请需要哪些材料？",
		questionTruncated: false,
		requestId: "req_pg_001",
		runStatus: "completed",
		startedAt: new Date("2026-07-09T07:29:00.000Z"),
		status: "completed",
		terminalReason: "answer",
		...overrides,
	};
}

export function runDiagnostics(
	overrides: { attempts?: OpsRequestModelAttemptRow[]; steps?: OpsRequestStageRow[] } = {},
): OpsRequestDiagnosticsRows {
	return {
		modelAttempts: overrides.attempts ?? [runAttemptRow()],
		stages: overrides.steps ?? [runStepRow()],
	};
}

export function runStepRow(overrides: Partial<OpsRequestStageRow> = {}): OpsRequestStageRow {
	return {
		completedAt: new Date("2026-07-09T07:29:03.800Z"),
		durationMs: 3_100,
		sanitizedPayloadJson: {
			agent_runtime_release: "agent-runtime@899f251",
			execution_control_release: "execution-control@a77a046",
		},
		stepId: "step_001",
		startedAt: new Date("2026-07-09T07:29:00.700Z"),
		status: "completed",
		stepKind: "agent",
		updatedAt: new Date("2026-07-09T07:29:03.800Z"),
		...overrides,
	};
}

export function runAttemptRow(
	overrides: Partial<OpsRequestModelAttemptRow> = {},
): OpsRequestModelAttemptRow {
	return {
		cachedInputTokens: 200,
		completedAt: new Date("2026-07-09T07:29:03.800Z"),
		durationMs: 3_100,
		failCloseReason: "",
		inputTokens: 1_200,
		modelName: "deepseek-v4-flash-0731",
		modelProvider: "openai-compatible",
		modelRequestCount: 1,
		outputTokens: 240,
		sanitizedPayloadJson: {
			agent_runtime_release: "agent-runtime@899f251",
			execution_control_release: "execution-control@a77a046",
		},
		startedAt: new Date("2026-07-09T07:29:00.700Z"),
		status: "completed",
		terminalReason: "",
		usageObserved: true,
		...overrides,
	};
}

function filterRequestRows(
	rows: OpsRequestDetailRow[],
	query: OpsRequestListQuery,
	since: Date,
): OpsRequestDetailRow[] {
	return rows
		.filter((row) => query.requestId || row.startedAt >= since)
		.filter((row) => {
			if (requestListView(query) === "attention" && row.attentionReason === null) {
				return false;
			}
			if (query.status) {
				const statuses = {
					ACTION_REQUIRED: ["approval_required"],
					CANCELLED: ["cancelled"],
					COMPLETED: ["completed"],
					FAILED: ["error", "rejected"],
					PENDING: ["accepted"],
					RUNNING: ["running"],
				}[query.status];
				if (!statuses.includes(row.status)) {
					return false;
				}
			}
			if (query.requestId && row.requestId !== query.requestId) {
				return false;
			}
			if (query.q) {
				const text = [
					row.errorCode,
					row.executionFailureKind,
					row.questionPreview,
					row.requestId,
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
		} else if (["error", "rejected"].includes(row.status)) {
			summary.failed += 1;
		} else if (row.status === "approval_required") {
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
