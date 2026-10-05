import type { Client, WorkflowExecutionDescription } from "@temporalio/client";
import { describe, expect, it } from "vitest";
import { projectTemporalStages, taskFailureMessage } from "../src/server/temporal-task-stages.ts";
import { TaskStageSchema } from "../src/shared/task-stages.ts";

const payloads = (value: unknown) => ({ payloads: [{ data: Buffer.from(JSON.stringify(value)) }] });
const client = {
	workflow: {
		options: {
			loadedDataConverter: {
				payloadConverter: {
					fromPayload: (payload: { data: Uint8Array }) =>
						JSON.parse(Buffer.from(payload.data).toString()),
				},
			},
		},
	},
} as unknown as Client;
const scheduled = (eventId: number, id: string, name: string) => ({
	eventId,
	eventTime: { seconds: 1791036000 },
	activityTaskScheduledEventAttributes: { activityId: id, activityType: { name } },
});
function project(events: unknown[], pendingActivities: unknown[], status = "RUNNING") {
	return projectTemporalStages(
		client,
		{ events } as Parameters<typeof projectTemporalStages>[1],
		{ status: { name: status }, raw: { pendingActivities } } as WorkflowExecutionDescription,
	);
}

describe("Temporal task progress", () => {
	it("keeps completed collection while classification runs, including partial business results", () => {
		const stages = project(
			[
				scheduled(5, "1", "collectNotices"),
				{
					activityTaskCompletedEventAttributes: {
						scheduledEventId: 5,
						result: payloads({
							summary: {
								outcome: "partial",
								noticesProcessed: 7404,
								noticesFailed: 27,
								noticesUpdated: 1,
								noticesUnchanged: 7403,
							},
						}),
					},
				},
				scheduled(10, "2", "classifyNotices"),
			],
			[
				{
					activityId: "2",
					activityType: { name: "classifyNotices" },
					state: 2,
					attempt: 1,
					heartbeatDetails: payloads({ processed: 2, total: 15 }),
				},
			],
		);
		expect(stages).toMatchObject([
			{
				id: "collectNotices",
				outcome: "partial",
				counts: {
					noticesProcessed: 7404,
					noticesFailed: 27,
					noticesUpdated: 1,
					noticesUnchanged: 7403,
				},
			},
			{
				id: "classifyNotices",
				outcome: "running",
				activity: { state: "running" },
				counts: { processed: 2, total: 15 },
			},
		]);
		for (const stage of stages) {
			expect(TaskStageSchema.safeParse(stage).success).toBe(true);
		}
	});
	it("preserves completed collection when classification fails and exposes its application cause", () => {
		const stages = project(
			[
				scheduled(5, "1", "collectNotices"),
				{
					activityTaskCompletedEventAttributes: {
						scheduledEventId: 5,
						result: payloads({ summary: { outcome: "success", noticesProcessed: 15 } }),
					},
				},
				scheduled(10, "2", "classifyNotices"),
				{
					activityTaskFailedEventAttributes: {
						scheduledEventId: 10,
						failure: {
							message: "Activity task failed",
							cause: { message: "provider rejected request" },
						},
					},
				},
			],
			[],
			"FAILED",
		);
		expect(stages).toMatchObject([
			{ id: "collectNotices", outcome: "success", counts: { noticesProcessed: 15 } },
			{
				id: "classifyNotices",
				outcome: "failed",
				error: "Activity task failed → provider rejected request",
			},
		]);
	});
	it("retains the last progress of a workflow that times out during retry scheduling", () => {
		const stages = project(
			[scheduled(5, "1", "collectNotices")],
			[
				{
					activityId: "1",
					activityType: { name: "collectNotices" },
					state: 1,
					attempt: 2,
					lastFailure: { message: "activity StartToClose timeout" },
					heartbeatDetails: payloads({ phase: "processing", processed: 727, total: 7431 }),
				},
			],
			"TIMED_OUT",
		);
		expect(stages).toMatchObject([
			{
				outcome: "timed_out",
				phase: "processing",
				counts: { processed: 727, total: 7431 },
				error: "activity StartToClose timeout",
				activity: { attempt: 2 },
			},
		]);
	});
	it("does not overwrite completed history with an older pending snapshot", () => {
		expect(
			project(
				[
					scheduled(5, "1", "collectNotices"),
					{
						activityTaskCompletedEventAttributes: {
							scheduledEventId: 5,
							result: payloads({ summary: { outcome: "success" } }),
						},
					},
				],
				[{ activityId: "1", activityType: { name: "collectNotices" }, state: 2 }],
			),
		).toMatchObject([{ id: "collectNotices", outcome: "success" }]);
	});
	it("marks activity timeout from history and retains the timeout heartbeat", () => {
		expect(
			project(
				[
					scheduled(5, "1", "collectNotices"),
					{
						activityTaskTimedOutEventAttributes: {
							scheduledEventId: 5,
							failure: {
								message: "heartbeat timeout",
								timeoutFailureInfo: {
									lastHeartbeatDetails: payloads({ phase: "writing", processed: 5, total: 10 }),
								},
							},
						},
					},
				],
				[],
				"FAILED",
			),
		).toMatchObject([
			{ outcome: "timed_out", counts: { processed: 5, total: 10 }, error: "heartbeat timeout" },
		]);
	});
	it("marks successfully finished activities without a business outcome as completed", () => {
		expect(
			project(
				[
					scheduled(5, "1", "prepareRefresh"),
					{
						activityTaskCompletedEventAttributes: {
							scheduledEventId: 5,
							result: payloads({ unchanged: false }),
						},
					},
				],
				[],
			),
		).toMatchObject([{ outcome: "completed" }]);
	});
	it("reads the nested application cause from SDK exceptions", () => {
		expect(
			taskFailureMessage(
				new Error("Workflow execution timed out", {
					cause: new Error("Workflow execution timed out"),
				}),
			),
		).toBe("Workflow execution timed out");
		expect(
			taskFailureMessage(
				new Error("Workflow execution failed", {
					cause: new Error("OBJECT_STORE_SOURCE is required"),
				}),
			),
		).toBe("Workflow execution failed → OBJECT_STORE_SOURCE is required");
	});
});
