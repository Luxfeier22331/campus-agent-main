import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, it, vi } from "vitest";
import { beginActivity } from "../src/activity-metadata.ts";
import { AgentControlClient } from "../src/control-client.ts";

afterEach(() => vi.restoreAllMocks());
it("reads the permanent application classification", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ code: "citation_validation_failed", retryable: false }, { status: 422 }),
	);
	await expect(
		new MockActivityEnvironment().run(() =>
			new AgentControlClient("http://control", "secret").call("finalize", {}),
		),
	).rejects.toMatchObject({ status: 422, code: "citation_validation_failed", retryable: false });
});
it("retains retryable behavior for an unclassified gateway failure", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
	await expect(
		new MockActivityEnvironment().run(() =>
			new AgentControlClient("http://control", "secret").call("project", {}),
		),
	).rejects.toMatchObject({ status: 503, retryable: true });
});
it("retains missing payload lookup behavior", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ code: "runtime_control_failed", retryable: true }, { status: 404 }),
	);
	await expect(
		new MockActivityEnvironment().run(() =>
			new AgentControlClient("http://control", "secret").maybeLoad("run", "missing"),
		),
	).resolves.toBeUndefined();
});

it("transmits retry identity and stable start time from the Activity context", async () => {
	const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({}));
	const control = new AgentControlClient("http://control", "secret");
	for (const attempt of [1, 2]) {
		await new MockActivityEnvironment({
			attempt,
			activityId: "model-turn",
			activityType: "modelTurn",
			taskQueue: "model",
			workflowExecution: { workflowId: "workflow", runId: "root" },
		}).run(async () => {
			beginActivity();
			await control.call("invocation/get", {
				request_id: "run",
				invocation_id: "turn",
				input_sha256: "hash",
			});
			await control.call("invocation/get", {
				request_id: "run",
				invocation_id: "turn",
				input_sha256: "hash",
			});
		});
	}
	const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
	expect(bodies.map((b) => b.activity.activity_attempt)).toEqual([1, 1, 2, 2]);
	expect(bodies[0].activity).toEqual(bodies[1].activity);
	expect(bodies[2].activity).toEqual(bodies[3].activity);
	expect(bodies[0].activity).toMatchObject({
		workflow_id: "workflow",
		temporal_run_id: "root",
		activity_id: "model-turn",
		activity_type: "modelTurn",
		task_queue: "model",
	});
});
