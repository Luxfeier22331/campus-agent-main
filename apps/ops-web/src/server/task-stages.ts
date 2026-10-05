import type { TaskStage } from "../shared/task-stages.ts";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
const countKeys = [
	"processed",
	"total",
	"classified",
	"failed",
	"requested",
	"skipped",
	"updated",
	"unchanged",
	"noticesAdded",
	"noticesUpdated",
	"noticesUnchanged",
	"noticesProcessed",
	"noticesFailed",
	"pagesFetched",
	"imagesDownloaded",
	"imagesReused",
	"attachmentsDownloaded",
	"attachmentsReused",
	"notices",
	"assets",
	"attachmentsMissing",
	"objectsWritten",
	"objectsReused",
];
export function projectStageResult(id: string, value: unknown, running = false): TaskStage {
	const outer = record(value);
	const data = { ...outer, ...record(outer.summary) };
	const outcome = data.outcome;
	return {
		id,
		...ranges(data),
		...(["scanning", "processing", "writing", "finalizing"].includes(String(data.phase))
			? { phase: data.phase as TaskStage["phase"] }
			: {}),
		outcome: running
			? "running"
			: outcome === "success" ||
					outcome === "partial" ||
					outcome === "failed" ||
					outcome === "skipped"
				? outcome
				: "unknown",
		counts: Object.fromEntries(
			countKeys.flatMap((key) => (typeof data[key] === "number" ? [[key, data[key]]] : [])),
		),
		error: typeof data.error === "string" ? data.error : null,
	};
}
export function projectTaskStages(result: unknown): TaskStage[] {
	const data = record(result);
	return ["collection", "classification", "publication", "rag", "cleanup", "files"].flatMap((id) =>
		data[id] && typeof data[id] === "object" ? [projectStageResult(id, data[id])] : [],
	);
}
function ranges(data: Record<string, unknown>) {
	const result: Pick<TaskStage, "processedRange" | "maintenanceRange"> = {};
	for (const key of ["processedRange", "maintenanceRange"] as const) {
		const range = record(data[key]);
		if (typeof range.from === "string" && typeof range.to === "string") {
			result[key] = { from: range.from, to: range.to };
		}
	}
	return result;
}
function timestamp(value: unknown): string | null {
	const data = record(value);
	if (data.seconds === undefined || data.seconds === null) {
		return null;
	}
	const time = Number(data.seconds) * 1000 + Number(data.nanos ?? 0) / 1_000_000;
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function projectRunningStage(
	type: string,
	heartbeats: unknown[],
	activity?: {
		state?: number | null;
		attempt?: number | null;
		maximumAttempts?: number | null;
		scheduledTime?: unknown;
		lastStartedTime?: unknown;
		lastHeartbeatTime?: unknown;
		nextAttemptScheduleTime?: unknown;
		lastFailure?: { message?: string | null } | null;
	},
): TaskStage {
	const result = projectStageResult(type, heartbeats.at(-1), true);
	if (activity) {
		const states: Record<number, NonNullable<TaskStage["activity"]>["state"]> = {
			1: "waiting",
			2: "running",
			3: "cancel_requested",
			4: "paused",
			5: "pause_requested",
		};
		result.activity = {
			state: states[activity.state ?? 0] ?? "unknown",
			attempt: activity.attempt ?? null,
			maximumAttempts: activity.maximumAttempts ?? null,
			nextAttemptAt: timestamp(activity.nextAttemptScheduleTime),
			scheduledAt: timestamp(activity.scheduledTime),
			startedAt: timestamp(activity.lastStartedTime),
			lastHeartbeatAt: timestamp(activity.lastHeartbeatTime),
			lastFailure: activity.lastFailure?.message ?? null,
		};
	}
	return result;
}
