import { describe, expect, it } from "vitest";

import { verifyLangfuseOnlineTraceEvidence } from "../src/index";

describe("Langfuse Hindsight memory trace evidence", () => {
	it("verifies sanitized runtime trace evidence with required memory steps", async () => {
		const evidence = await verifyLangfuseOnlineTraceEvidence({
			expectedRelease: "execution-control@abc123",
			expectedRequestId: "req-001",
			expectedRunId: "run-001",
			expectedSessionId: "conversation-001",
			expectedTags: ["surface:execution-control", "env:staging"],
			expectedUserId: "user-001",
			expectedWorkflowId: "workflow-001",
			requiredStepIds: ["memory.recall", "agent.primary"],
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						id: "trace-001",
						name: "online-answer",
						release: "execution-control@abc123",
						sessionId: "conversation-001",
						tags: ["surface:execution-control", "env:staging"],
						userId: "user-001",
						metadata: {
							request_id: "req-001",
							run_id: "run-001",
							trace_id: "trace-product-001",
							workflow_id: "workflow-001",
						},
						observations: [
							{
								id: "obs-001",
								metadata: {
									activity_attempt: 1,
									activity_type: "memory",
									duration_ms: 12,
									fail_close_reason: "",
									projection_ref: "projection-001",
									request_id: "req-001",
									run_id: "run-001",
									schedule_to_start_ms: 1,
									selected_tool: "any",
									status: "completed",
									step_id: "memory.recall",
									step_kind: "activity",
									task_queue: "context",
									trace_id: "trace-product-001",
									workflow_id: "workflow-001",
								},
							},
							{
								id: "obs-002",
								metadata: {
									activity_attempt: 1,
									activity_type: "agent",
									duration_ms: 45,
									fail_close_reason: "",
									projection_ref: "projection-002",
									request_id: "req-001",
									run_id: "run-001",
									schedule_to_start_ms: 2,
									selected_tool: "knowledge_query",
									status: "completed",
									step_id: "agent.primary",
									step_kind: "activity",
									task_queue: "agent",
									trace_id: "trace-product-001",
									workflow_id: "workflow-001",
								},
							},
						],
					}),
				),
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
			traceId: "trace-001",
		});

		expect(evidence.repo_owned_observation_count).toBe(2);
		expect((evidence.trace_identity as { request_id: string }).request_id).toBe("req-001");
		expect(evidence.required_step_ids).toEqual(["memory.recall", "agent.primary"]);
	});

	it("rejects missing required memory trace steps", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				expectedRelease: "release",
				expectedSessionId: "session",
				expectedTags: [],
				expectedUserId: "user",
				requiredStepIds: ["memory.recall"],
				fetchImpl: async () =>
					new Response(
						JSON.stringify({
							id: "trace-001",
							name: "online-answer",
							release: "release",
							sessionId: "session",
							tags: [],
							userId: "user",
							metadata: {
								request_id: "req-001",
								run_id: "run-001",
								trace_id: "trace-product-001",
								workflow_id: "workflow-001",
							},
							observations: [
								{
									metadata: {
										activity_attempt: 1,
										activity_type: "agent",
										duration_ms: 10,
										fail_close_reason: "",
										projection_ref: "projection-001",
										request_id: "req-001",
										run_id: "run-001",
										schedule_to_start_ms: 1,
										selected_tool: "knowledge_query",
										status: "completed",
										step_id: "agent.primary",
										step_kind: "activity",
										task_queue: "agent",
										trace_id: "trace-product-001",
										workflow_id: "workflow-001",
									},
								},
							],
						}),
					),
				settings: {
					baseUrl: "https://langfuse.example",
					environment: "staging",
					publicKey: "pk-test",
					secretKey: "sk-test",
				},
				traceId: "trace-001",
			}),
		).rejects.toThrow("trace evidence missing required steps: memory.recall");
	});

	it("allows memory identifiers in the trusted Langfuse trace", async () => {
		const evidence = await verifyLangfuseOnlineTraceEvidence({
			expectedRelease: "release",
			expectedSessionId: "session",
			expectedTags: [],
			expectedUserId: "user",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						id: "trace-001",
						name: "online-answer",
						release: "release",
						sessionId: "session",
						tags: [],
						userId: "user",
						metadata: {
							request_id: "req-001",
							run_id: "run-001",
							trace_id: "trace-product-001",
							workflow_id: "workflow-001",
						},
						observations: [
							{
								metadata: {
									activity_attempt: 1,
									activity_type: "memory",
									duration_ms: 10,
									fail_close_reason: "",
									operation_id: "op-memory-001",
									projection_ref: "projection-001",
									request_id: "req-001",
									run_id: "run-001",
									schedule_to_start_ms: 1,
									selected_tool: "any",
									status: "completed",
									step_id: "memory.append",
									step_kind: "activity",
									task_queue: "memory",
									trace_id: "trace-product-001",
									workflow_id: "workflow-001",
								},
							},
						],
					}),
				),
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
			traceId: "trace-001",
		});

		expect(evidence.repo_owned_observation_count).toBe(1);
	});
});
