import { Context } from "@temporalio/activity";
import type { ActivityMetadata } from "campus-contracts/agent-runtime-control";

const starts = new WeakMap<Context, string>();
export function beginActivity(): void {
	starts.set(Context.current(), new Date().toISOString());
}
export function currentActivityMetadata(): ActivityMetadata {
	const context = Context.current();
	const info = context.info;
	if (!info.workflowExecution) {
		throw new Error("Agent activity requires a workflow execution");
	}
	return {
		workflow_id: info.workflowExecution.workflowId,
		temporal_run_id: info.workflowExecution.runId,
		activity_id: info.activityId,
		activity_type: info.activityType,
		activity_attempt: info.attempt,
		task_queue: info.taskQueue,
		scheduled_at: new Date(info.currentAttemptScheduledTimestampMs).toISOString(),
		started_at: starts.get(context) ?? new Date().toISOString(),
	};
}
