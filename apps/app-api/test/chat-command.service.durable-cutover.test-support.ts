import type {
	ExecutionGatewayRun,
	ExecutionGatewayRunEvent,
} from "../src/modules/integration/execution-gateway";

export function durableRun(overrides: Partial<ExecutionGatewayRun> = {}): ExecutionGatewayRun {
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: "conv_01HQ",
		createdAt: "2026-06-04T01:02:03Z",
		failCloseReason: "",
		finalResponseRef: "",
		lane: "rag",
		ownerUserId: "user_01HQ",
		requestId: "req_0001",
		requestedCapability: "knowledge",
		runId: "run_0001",
		selectedCapability: "knowledge",
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: "public_chat_web",
		terminalReason: "",
		traceId: "trace_0001",
		turnId: "turn_0001",
		updatedAt: "2026-06-04T01:02:04Z",
		workflowPlanRef: "",
		...overrides,
	};
}

export function answerResponsePayload(text = "国家奖学金每学年评审一次。") {
	return {
		answer_text: text,
		confidence: "high",
		error: null,
		follow_up_question: "",
		observability: {
			citation_count: 1,
			citation_expected: true,
			citation_missing: false,
			fail_closed: false,
			retrieval_attempted: true,
			retrieved_source_count: 1,
		},
		result: {
			evidence: {
				sources: [{ doc_id: "student_rules:national-scholarship" }],
			},
		},
		selected_target: "rag-agent",
		status: "completed",
		trace_id: "trace_0001",
	};
}

export function durableEvent(
	overrides: Partial<ExecutionGatewayRunEvent> & {
		eventType: string;
		sequence: number;
	},
): ExecutionGatewayRunEvent {
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
