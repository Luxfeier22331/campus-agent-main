import type { Client, WorkflowExecutionDescription, WorkflowHandle } from "@temporalio/client";
import type { TaskStage } from "../shared/task-stages.ts";
import { projectRunningStage, projectStageResult } from "./task-stages.ts";

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;
type Payload = NonNullable<
	NonNullable<History["events"]>[number]["activityTaskCompletedEventAttributes"]
>["result"];

// Temporal and SDK errors both carry a cause chain. Keep the application cause visible.
export function taskFailureMessage(failure: unknown): string {
	if (!failure || typeof failure !== "object") {
		return String(failure);
	}
	const value = failure as { message?: string; cause?: unknown };
	const cause = value.cause ? taskFailureMessage(value.cause) : null;
	return [value.message, cause === value.message ? null : cause].filter(Boolean).join(" → ");
}

export function projectTemporalStages(
	client: Client,
	history: History,
	execution: WorkflowExecutionDescription,
): TaskStage[] {
	const decode = (payloads: Payload) =>
		payloads?.payloads?.map((payload) =>
			client.workflow.options.loadedDataConverter.payloadConverter.fromPayload(payload),
		) ?? [];
	const scheduled = new Map<string, { id: string; type: string }>();
	const stages = new Map<string, TaskStage>();
	const running = execution.status.name === "RUNNING";
	const stopped =
		execution.status.name === "TIMED_OUT"
			? "timed_out"
			: ["CANCELED", "CANCELLED"].includes(execution.status.name)
				? "canceled"
				: execution.status.name === "TERMINATED"
					? "terminated"
					: "failed";
	for (const event of history.events ?? []) {
		const activity = event.activityTaskScheduledEventAttributes;
		if (activity) {
			const id = activity.activityId ?? String(event.eventId);
			const type = activity.activityType?.name ?? "unknown";
			scheduled.set(String(event.eventId), { id, type });
			stages.set(id, projectRunningStage(type, [], { state: 1, scheduledTime: event.eventTime }));
			continue;
		}
		const completed = event.activityTaskCompletedEventAttributes;
		const failed = event.activityTaskFailedEventAttributes;
		const timedOut = event.activityTaskTimedOutEventAttributes;
		const canceled = event.activityTaskCanceledEventAttributes;
		const end = completed ?? failed ?? timedOut ?? canceled;
		if (!end) {
			continue;
		}
		const entry = scheduled.get(String(end.scheduledEventId));
		if (!entry) {
			continue;
		}
		const stage = completed
			? projectStageResult(entry.type, decode(completed.result)[0])
			: projectRunningStage(
					entry.type,
					decode(timedOut?.failure?.timeoutFailureInfo?.lastHeartbeatDetails),
				);
		if (completed) {
			if (stage.outcome === "unknown") {
				stage.outcome = "completed";
			}
		} else {
			stage.outcome = timedOut ? "timed_out" : canceled ? "canceled" : "failed";
			stage.error =
				failed?.failure || timedOut?.failure
					? taskFailureMessage(failed?.failure ?? timedOut?.failure)
					: null;
		}
		stages.set(entry.id, stage);
	}
	for (const activity of execution.raw.pendingActivities ?? []) {
		const stage = projectRunningStage(
			activity.activityType?.name ?? "unknown",
			decode(activity.heartbeatDetails),
			activity,
		);
		// A history read may already contain completion while Describe still reports it pending.
		if (
			stages.get(activity.activityId ?? "")?.outcome === "running" ||
			!stages.has(activity.activityId ?? "")
		) {
			stages.set(activity.activityId ?? stage.id, stage);
		}
	}
	for (const stage of stages.values()) {
		if (!running && stage.outcome === "running") {
			stage.outcome = stopped;
			stage.error = stage.activity?.lastFailure ?? null;
		}
	}
	return [...stages.values()];
}
