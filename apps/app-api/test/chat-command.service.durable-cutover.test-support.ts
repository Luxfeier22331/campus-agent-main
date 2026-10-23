import type {
	AgentControlRun,
	AgentControlRunEvent,
	AgentControlRunEventPage,
} from "../src/modules/integration/agent-control";

export function durableRun(overrides: Partial<AgentControlRun> = {}): AgentControlRun {
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
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: "campus_web",
		terminalReason: "",
		updatedAt: "2026-06-04T01:02:04Z",
		...overrides,
	};
}

export function answerResponsePayload(text = "国家奖学金每学年评审一次。") {
	return {
		answer_text: text,
		error: null,
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
					citation_index: 1,
					document_id: "student_rules/national-scholarship",
					kind: "campus_document",
					root_unit_ids: ["national-scholarship-review"],
					section_ref: "/docs/regulations/student_rules/national-scholarship/v/2026#review",
					section_title: "评审规则",
					snippet: "国家奖学金每学年评审一次。",
					title: "学生奖学金评审办法",
					version_id: "version-national-scholarship-2026",
					version_slug: "2026",
				},
			],
		},
		status: "completed" as const,
	};
}

export function durableEvent(
	overrides: Partial<AgentControlRunEvent> & {
		eventType: string;
		sequence: number;
	},
): AgentControlRunEvent {
	const { eventType, sequence, ...rest } = overrides;
	return {
		conversationId: "conv_01HQ",
		eventId: `event-${sequence}`,
		eventType,
		occurredAt: "2026-06-04T01:02:04.000Z",
		payload: {},
		payloadSchemaVersion: "run-event-v1",
		requestId: "req_0001",
		sequence,
		visibility: "browser",
		...rest,
	};
}

export function durableEventPage(
	events: AgentControlRunEvent[],
	nextSequence = events.at(-1)?.sequence ?? 0,
): AgentControlRunEventPage {
	return { events, nextSequence };
}
