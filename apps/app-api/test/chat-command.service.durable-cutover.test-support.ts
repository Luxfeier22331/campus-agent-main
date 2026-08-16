import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
	ExecutionControlRunEventPage,
	ExecutionControlRunStepTrajectory,
} from "../src/modules/integration/execution-control";

export function durableRun(overrides: Partial<ExecutionControlRun> = {}): ExecutionControlRun {
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: "conv_01HQ",
		createdAt: "2026-06-04T01:02:03Z",
		failCloseReason: "",
		finalResponseRef: "",
		taskQueue: "campus-agent.workflow",
		ownerUserId: "user_01HQ",
		queuedAt: "2026-06-04T01:02:04Z",
		requestId: "req_0001",
		runId: "run_0001",
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: "campus_web",
		terminalReason: "",
		traceId: "trace_0001",
		turnId: "turn_0001",
		updatedAt: "2026-06-04T01:02:04Z",
		...overrides,
	};
}

export function emptyRunStepTrajectory(): ExecutionControlRunStepTrajectory {
	return {
		attempts: [],
		results: [],
		steps: [],
	};
}

export function answerResponsePayload(text = "国家奖学金每学年评审一次。") {
	return {
		answer_text: text,
		confidence: "high",
		error: null,
		follow_up_question: "",
		model_usage: {
			cached_input_tokens: 10,
			input_tokens: 120,
			output_tokens: 42,
			total_tokens: 162,
		},
		observability: {
			agent_runtime: "openai_agents_sdk",
			terminal_reason: "answer",
		},
		result: {
			sources: [
				{
					document_id: "student_rules/national-scholarship",
					root_unit_ids: ["national-scholarship-review"],
					section_ref: "/docs/regulations/student_rules/national-scholarship/v/2026-current#review",
					section_title: "评审规则",
					snippet: "国家奖学金每学年评审一次。",
					title: "学生奖学金评审办法",
					version_id: "version-national-scholarship-2026",
					version_label: "2026 版",
					version_slug: "2026-current",
				},
			],
		},
		status: "completed",
		trace_id: "trace_0001",
		workflow_trace_summary: {
			execution_path: "tool_assisted",
			terminal_reason: "answer",
			answer_artifact_refs: ["projection://runs/run_0001/agent/primary/result"],
			runtime_versions: { agent_runtime: "openai_agents_sdk" },
		},
	};
}

export function durableEvent(
	overrides: Partial<ExecutionControlRunEvent> & {
		eventType: string;
		sequence: number;
	},
): ExecutionControlRunEvent {
	const { eventType, sequence, ...rest } = overrides;
	return {
		conversationId: "conv_01HQ",
		eventId: `event-${sequence}`,
		eventType,
		occurredAt: "2026-06-04T01:02:04.000Z",
		payload: {},
		payloadSchemaVersion: "run-event-v1",
		runId: "run_0001",
		sequence,
		visibility: "browser",
		...rest,
	};
}

export function durableEventPage(
	events: ExecutionControlRunEvent[],
	nextSequence = events.at(-1)?.sequence ?? 0,
): ExecutionControlRunEventPage {
	return { events, nextSequence };
}
