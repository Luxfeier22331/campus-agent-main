import { decodeRequestCursor } from "../src/server/ops-status-mappers";
import type {
	OpsObservabilityReadAuditInput,
	OpsRequestListQuery,
	OpsRequestObservabilityRow,
	OpsRequestRow,
	OpsTemporalTaskQueueRow,
	OpsTemporalTaskQueueSource,
	PgOpsStatusStoreDatabase,
} from "../src/server/ops-status-store";

export function createFakeOpsDb(
	overrides: {
		observabilityRows?: ReturnType<typeof requestObservabilityRow>[];
		requestRows?: OpsRequestRow[];
	} = {},
): PgOpsStatusStoreDatabase & { auditEvents: OpsObservabilityReadAuditInput[] } {
	const requestRows = overrides.requestRows ?? [requestRow()];
	const observabilityRows = overrides.observabilityRows ?? [requestObservabilityRow()];
	const auditEvents: OpsObservabilityReadAuditInput[] = [];

	return {
		auditEvents,
		async getRequestObservability(requestId) {
			return observabilityRows.find((row) => row.requestId === requestId) ?? null;
		},
		async getRequestObservabilities(requestIds) {
			const requestIdSet = new Set(requestIds);
			return observabilityRows.filter((row) => requestIdSet.has(row.requestId));
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
					visible.map((row) => row.projectedAt).sort((a, b) => b.valueOf() - a.valueOf())[0] ??
					null,
				p95DurationMs:
					durations.length > 0 ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
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
			const filtered = filterRequestRows(requestRows, query, since);
			const cursor = decodeRequestCursor(query.cursor);
			const visible = cursor
				? filtered.filter(
						(row) =>
							row.startedAt.toISOString() < cursor.startedAt ||
							(row.startedAt.toISOString() === cursor.startedAt &&
								row.requestId < cursor.requestId),
					)
				: filtered;
			return visible.slice(0, query.limit + 1);
		},
		async summarizeRequests(query, since) {
			return summarizeRows(filterRequestRows(requestRows, query, since));
		},
		async verifyObservabilityReadAuditWrite() {
			return;
		},
		async verifyReadiness() {
			return;
		},
		async writeObservabilityReadAudit(input) {
			auditEvents.push(input);
		},
	};
}

export function createFakeTemporalTaskQueueSource(
	rows: OpsTemporalTaskQueueRow[] = requiredTemporalQueueRows(),
): OpsTemporalTaskQueueSource {
	return { getTaskQueues: async () => rows };
}

export function requestRow(overrides: Partial<OpsRequestRow> = {}): OpsRequestRow {
	return {
		completedAt: new Date("2026-07-09T07:29:04.000Z"),
		conversationId: "conv_pg_001",
		durationMs: 4200,
		errorCode: null,
		principalId: "student-123",
		principalType: "student",
		projectedAt: new Date("2026-07-09T07:29:05.000Z"),
		questionPreview: "今天班车什么时候发车？",
		requestId: "req_pg_001",
		requestedTool: "transport_schedule_lookup",
		runId: "run_pg_001",
		selectedTool: "transport_schedule_lookup",
		startedAt: new Date("2026-07-09T07:29:00.000Z"),
		status: "completed",
		traceId: "trace_pg_001",
		...overrides,
	};
}

export function requestObservabilityRow(): OpsRequestObservabilityRow {
	return {
		aclAnomalyCode: null,
		aclDecision: "allowed",
		failClosed: false,
		measuredAt: new Date("2026-07-09T07:29:05.000Z"),
		modelName: "gpt-4.1-mini",
		modelProvider: "openai",
		promptId: "campus-primary-agent",
		promptVersion: "current",
		projectionLagMs: 120,
		refusalClass: null,
		requestId: "req_pg_001",
		resolvedTargetsJson: ["student_rules"],
		semanticOutcome: "answer",
		stageTimingJson: { "agent.primary_ms": 1400, "request.total_ms": 4200 },
		supportingSourcesJson: [
			{
				canonicalUrl: "/docs/transport",
				sourceKind: "campus_service",
				sourceTitle: "班车时刻表",
				targetKind: "canonical_reader",
				versionId: "transport-current",
			},
		],
		templateSha256: "sha256:fixture-template",
		traceAvailable: true,
		updatedAt: new Date("2026-07-09T07:29:05.000Z"),
		workflowTraceSummaryJson: {
			direct_vs_delegate_branch: "tool",
			first_decision_actor: "primary_agent",
			planning_outcome: "primary_agent_completed",
			runtime_versions: { agent_runtime: "openai_agents_sdk" },
			selected_tools: ["transport_schedule_lookup"],
			terminal_reason: "answer",
			trace_steps: [
				{
					outcome: "answer",
					parent_step_id: "",
					result_status: "completed",
					span_kind: "agent",
					step_id: "agent.primary",
				},
			],
			workflow_mode: "single_step",
		},
	};
}

export function temporalQueueRow(
	overrides: Partial<OpsTemporalTaskQueueRow> = {},
): OpsTemporalTaskQueueRow {
	return {
		backlogJson: { count: 3 },
		oldestTaskAgeJson: { backlogCount: 3, ms: 2400, state: "observed" },
		pollerCount: 4,
		projectedAt: new Date("2026-07-09T07:29:06.000Z"),
		taskQueue: "campus-agent.activity.agent",
		taskQueueKind: "activity",
		...overrides,
	};
}

export function requiredTemporalQueueRows(): OpsTemporalTaskQueueRow[] {
	return [
		temporalQueueRow({ taskQueue: "campus-agent.workflow", taskQueueKind: "workflow" }),
		temporalQueueRow({ taskQueue: "campus-agent.activity.core" }),
		temporalQueueRow({ taskQueue: "campus-agent.activity.agent" }),
	];
}

function filterRequestRows(
	rows: OpsRequestRow[],
	query: OpsRequestListQuery,
	since: Date,
): OpsRequestRow[] {
	return rows
		.filter((row) => row.startedAt >= since)
		.filter((row) => {
			if (query.status) {
				const statuses = {
					CANCELLED: ["cancelled"],
					COMPLETED: ["completed"],
					FAILED: ["error", "rejected", "no_answer"],
					PENDING: ["accepted", "approval_required", "needs_clarification"],
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
			if (query.traceId && row.traceId !== query.traceId) {
				return false;
			}
			if (query.q) {
				const text = [
					row.conversationId,
					row.errorCode,
					row.questionPreview,
					row.requestedTool,
					row.requestId,
					row.selectedTool,
					row.traceId,
				].join(" ");
				if (!text.toLowerCase().includes(query.q.toLowerCase())) {
					return false;
				}
			}
			return true;
		});
}

function summarizeRows(rows: OpsRequestRow[]) {
	const summary = { cancelled: 0, completed: 0, failed: 0, pending: 0, running: 0, total: 0 };
	for (const row of rows) {
		if (row.status === "completed") {
			summary.completed += 1;
		} else if (row.status === "cancelled") {
			summary.cancelled += 1;
		} else if (["error", "rejected", "no_answer"].includes(row.status)) {
			summary.failed += 1;
		} else if (["accepted", "approval_required", "needs_clarification"].includes(row.status)) {
			summary.pending += 1;
		} else {
			summary.running += 1;
		}
		summary.total += 1;
	}
	return summary;
}
