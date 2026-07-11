import type { OpsOverviewResponse } from "../shared/ops-contract.ts";
import { readMetricCount, readMetricMs } from "./ops-status-mappers.ts";
import type { OpsTemporalTaskQueueRow } from "./ops-status-store.ts";

const TASK_QUEUE_READY_THRESHOLD_MS = 30_000;
const TASK_QUEUE_STALE_THRESHOLD_MS = 120_000;

export const REQUIRED_TEMPORAL_TASK_QUEUES = [
	{ kind: "WORKFLOW", name: "workflow", taskQueue: "campus-agent.workflow" },
	{ kind: "ACTIVITY", name: "core", taskQueue: "campus-agent.activity.core" },
	{ kind: "ACTIVITY", name: "agent", taskQueue: "campus-agent.activity.agent" },
	{ kind: "ACTIVITY", name: "knowledge", taskQueue: "campus-agent.activity.knowledge" },
] as const;

export function summarizeTemporalTaskQueues(
	rows: OpsTemporalTaskQueueRow[],
	now: Date,
): OpsOverviewResponse["temporal"] {
	const latestByQueue = new Map(rows.map((row) => [row.taskQueue, row]));
	const queues = REQUIRED_TEMPORAL_TASK_QUEUES.map((required) =>
		toQueueSummary(required, latestByQueue.get(required.taskQueue) ?? null, now),
	);
	for (const row of rows) {
		if (REQUIRED_TEMPORAL_TASK_QUEUES.some((item) => item.taskQueue === row.taskQueue)) {
			continue;
		}
		queues.push(
			toQueueSummary(
				{
					kind: normalizeQueueKind(row.taskQueueKind),
					name: row.taskQueue.replace(/^campus-agent\./, ""),
					taskQueue: row.taskQueue,
				},
				row,
				now,
			),
		);
	}
	const status = aggregateQueueHealth(queues);
	const dataState = resolveTemporalDataState(rows, queues);
	const updatedAt =
		rows
			.map((row) => row.projectedAt)
			.sort((left, right) => right.valueOf() - left.valueOf())[0]
			?.toISOString() ?? null;
	const knownAges = queues
		.map((queue) => queue.oldestTaskAgeMs)
		.filter((value): value is number => value !== null);
	return {
		backlogCount: queues.reduce((total, queue) => total + queue.backlogCount, 0),
		dataState,
		oldestTaskAgeMs: knownAges.length > 0 ? Math.max(...knownAges) : null,
		pollerCount: queues.reduce((total, queue) => total + queue.pollerCount, 0),
		queues,
		reason: queues.find((queue) => queue.status === status)?.reason ?? null,
		status,
		updatedAt,
	};
}

function toQueueSummary(
	required: { kind: "ACTIVITY" | "WORKFLOW" | "UNKNOWN"; name: string; taskQueue: string },
	row: OpsTemporalTaskQueueRow | null,
	now: Date,
): OpsOverviewResponse["temporal"]["queues"][number] {
	if (!row) {
		return {
			backlogCount: 0,
			dataState: "NO_DATA",
			kind: required.kind,
			name: required.name,
			oldestTaskAgeMs: null,
			pollerCount: 0,
			reason: `缺少 ${required.taskQueue} 队列状态。`,
			status: "OUTAGE",
			taskQueue: required.taskQueue,
			updatedAt: null,
		};
	}
	const lagMs = Math.max(0, now.valueOf() - row.projectedAt.valueOf());
	const oldestTaskAge = readOldestTaskAge(row.oldestTaskAgeJson);
	const oldestTaskAgeMs = oldestTaskAge.value;
	let dataState: OpsOverviewResponse["temporal"]["dataState"] = "FRESH";
	let reason: string | null = null;
	let status: OpsOverviewResponse["temporal"]["status"] = "HEALTHY";
	if (lagMs > TASK_QUEUE_STALE_THRESHOLD_MS) {
		dataState = "STALE";
		status = "DEGRADED";
		reason = `${required.taskQueue} 队列状态超过两分钟未更新。`;
	} else if (row.pollerCount <= 0) {
		status = "OUTAGE";
		reason = `${required.taskQueue} 没有正在轮询的工作进程。`;
	} else if (oldestTaskAge.state === "UNSUPPORTED") {
		dataState = "UNAVAILABLE";
		status = "UNKNOWN";
		reason = `${required.taskQueue} 的数据源不提供最久等待时间。`;
	} else if (oldestTaskAge.state === "INVALID") {
		dataState = "UNAVAILABLE";
		status = "DEGRADED";
		reason = `${required.taskQueue} 的最久等待时间缺失或格式错误。`;
	} else if (
		oldestTaskAge.state === "OBSERVED" &&
		oldestTaskAge.value > TASK_QUEUE_READY_THRESHOLD_MS
	) {
		status = "DEGRADED";
		reason = `${required.taskQueue} 最旧任务等待超过 30 秒。`;
	}
	return {
		backlogCount:
			readMetricCount(row.backlogJson, "count") ||
			readMetricCount(row.backlogJson, "backlogCount") ||
			readMetricCount(row.oldestTaskAgeJson, "backlogCount"),
		dataState,
		kind: required.kind,
		name: required.name,
		oldestTaskAgeMs,
		pollerCount: Math.max(0, row.pollerCount),
		reason,
		status,
		taskQueue: required.taskQueue,
		updatedAt: row.projectedAt.toISOString(),
	};
}

function readOldestTaskAge(
	value: unknown,
):
	| { state: "INVALID"; value: null }
	| { state: "OBSERVED"; value: number }
	| { state: "UNSUPPORTED"; value: null } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { state: "INVALID", value: null };
	}
	if ((value as Record<string, unknown>).state === "unsupported_by_source") {
		return { state: "UNSUPPORTED", value: null };
	}
	const ms = (value as Record<string, unknown>).ms;
	return typeof ms === "number" && Number.isInteger(ms) && ms >= 0
		? { state: "OBSERVED", value: readMetricMs(value) }
		: { state: "INVALID", value: null };
}

function aggregateQueueHealth(
	queues: OpsOverviewResponse["temporal"]["queues"],
): OpsOverviewResponse["temporal"]["status"] {
	if (queues.some((queue) => queue.status === "OUTAGE")) {
		return "OUTAGE";
	}
	if (queues.some((queue) => queue.status === "DEGRADED")) {
		return "DEGRADED";
	}
	if (queues.length > 0 && queues.every((queue) => queue.status === "UNKNOWN")) {
		return "UNKNOWN";
	}
	return "HEALTHY";
}

function resolveTemporalDataState(
	rows: OpsTemporalTaskQueueRow[],
	queues: OpsOverviewResponse["temporal"]["queues"],
): OpsOverviewResponse["temporal"]["dataState"] {
	if (rows.length === 0) {
		return "NO_DATA";
	}
	if (queues.some((queue) => queue.dataState === "STALE")) {
		return "STALE";
	}
	if (queues.every((queue) => queue.dataState === "UNAVAILABLE")) {
		return "UNAVAILABLE";
	}
	return "FRESH";
}

function normalizeQueueKind(value: string | null | undefined): "ACTIVITY" | "WORKFLOW" | "UNKNOWN" {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "activity") {
		return "ACTIVITY";
	}
	if (normalized === "workflow") {
		return "WORKFLOW";
	}
	return "UNKNOWN";
}
