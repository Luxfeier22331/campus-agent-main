import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
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
		requestedTool: "knowledge_query",
		runId: "run_0001",
		selectedTool: "knowledge_query",
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
		resolved_targets: ["student_rules"],
		session_update: null,
		observability: {
			agent_runtime: "openai_agents_sdk",
			selected_tools: ["knowledge_query"],
			terminal_reason: "answer",
		},
		result: {
			sources: [
				{
					canonical_url: "/docs/regulations/student_rules/national-scholarship",
					source_kind: "regulation",
					source_title: "学生奖学金评审办法",
					target_kind: "canonical_reader",
				},
			],
		},
		selected_tool: "knowledge_query",
		status: "completed",
		trace_id: "trace_0001",
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
