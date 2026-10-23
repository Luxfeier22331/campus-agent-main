import { vi } from "vitest";

import type {
	AgentControlRun,
	AgentControlRunEvent,
} from "../src/modules/integration/agent-control";
import type { RuntimeRunOwnershipRecord, RuntimeRunStore } from "../src/modules/runtime-run";

export function durableRun(overrides: Partial<AgentControlRun> = {}): AgentControlRun {
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: "conv_01HQ",
		createdAt: "2026-06-04T01:02:03.000Z",
		failCloseReason: "",
		finalResponseRef: "",
		taskQueue: "campus-agent.workflow",
		ownerUserId: "user_01HQ",
		queuedAt: "2026-06-04T01:02:03.500Z",
		requestId: "req_01HQ",
		startedAt: "",
		status: "running",
		streamingStartedAt: "",
		surface: "campus_web",
		terminalReason: "",
		updatedAt: "2026-06-04T01:02:04.000Z",
		...overrides,
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
		occurredAt: "2026-06-04T01:02:06.000Z",
		payload: {},
		payloadSchemaVersion: "run-event-v1",
		requestId: "req_01HQ",
		sequence,
		visibility: "browser",
		...rest,
	};
}

export function ownedRun(
	overrides: Partial<RuntimeRunOwnershipRecord> = {},
): RuntimeRunOwnershipRecord {
	return {
		acceptedAt: "2026-06-04T01:02:03.000Z",
		completedAt: null,
		conversationId: "conv_01HQ",
		requestId: "req_01HQ",
		status: "accepted",
		...overrides,
	};
}

export function runtimeStore(overrides: Partial<RuntimeRunStore> = {}): RuntimeRunStore {
	return {
		getOwnedRun: vi.fn().mockResolvedValue(ownedRun()),
		...overrides,
	};
}

export function eventPage(events: AgentControlRunEvent[], nextSequence?: number) {
	return {
		events,
		nextSequence: nextSequence ?? events.at(-1)?.sequence ?? 0,
	};
}
