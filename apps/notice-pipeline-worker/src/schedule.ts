import {
	Client,
	Connection,
	ScheduleAlreadyRunning,
	ScheduleOverlapPolicy,
} from "@temporalio/client";

export const REFRESH_SCHEDULE_ID = "notice-pipeline";
export const RAG_TASK_QUEUE = "notice-pipeline";
export async function connectTemporal(env = process.env) {
	const connection = await Connection.connect({
		address: env.TEMPORAL_ADDRESS ?? "localhost:7233",
	});
	return {
		connection,
		client: new Client({ connection, namespace: env.TEMPORAL_NAMESPACE ?? "default" }),
	};
}

export async function initializeSchedule(client: Client) {
	const action = {
		type: "startWorkflow" as const,
		workflowType: "noticePipelineScheduled",
		taskQueue: RAG_TASK_QUEUE,
		workflowExecutionTimeout: "4 hours" as const,
	};
	const policies = { overlap: ScheduleOverlapPolicy.SKIP, catchupWindow: "5 minutes" as const };
	try {
		await client.schedule.create({
			scheduleId: REFRESH_SCHEDULE_ID,
			spec: { intervals: [{ every: "15 minutes" }] },
			action,
			policies,
			state: {
				paused: true,
				note: "Enable after artifact registration and a successful manual run",
			},
		});
	} catch (error) {
		if (!(error instanceof ScheduleAlreadyRunning)) {
			throw error;
		}
		await client.schedule.getHandle(REFRESH_SCHEDULE_ID).update((existing) => ({
			...existing,
			action,
			policies,
			spec: existing.spec,
			state: existing.state,
		}));
	}
}
