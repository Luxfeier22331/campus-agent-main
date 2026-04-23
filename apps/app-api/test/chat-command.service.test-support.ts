import { createHmac } from "node:crypto";

import { vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { ChatMessage } from "../src/modules/chat";
import type { SupervisorExecutionClient } from "../src/modules/integration/supervisor";
import {
	buildChatCommandService,
	type ChatCommandStore,
	type ChatConversationStore,
	DRAFT_CONVERSATION_TITLE,
	deriveSafetyIdentifier,
	type FinalizeRequestWrite,
	SupervisorTransportError,
} from "../src/modules/runtime-command";
import type { AppTelemetry } from "../src/modules/telemetry";

export type {
	AppTelemetry,
	ChatCommandStore,
	ChatConversationStore,
	FinalizeRequestWrite,
	ResolvedAppPrincipal,
	SupervisorExecutionClient,
};
export {
	buildChatCommandService,
	createHmac,
	DRAFT_CONVERSATION_TITLE,
	deriveSafetyIdentifier,
	SupervisorTransportError,
};

export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

function createAuthorization() {
	return {
		applicabilityScope: "undergraduate",
		approvalState: "not_required",
		entitlementGroups: ["students"],
		entitlementSnapshotId: "entitlements-2026-03-29",
		ownershipScopes: ["conversation:user_01HQ"],
		principalId: "user_01HQ",
		projectionSource: "campus_identity" as const,
		retrievalFilter: {
			entitlementGroups: ["students"],
			policyProjectionVersion: "phase1-authorization-projection-v1",
			visibilityLevel: "public",
			visibilityScope: "main",
		},
		visibilityScope: "main",
	};
}

export function createPrincipal(): ResolvedAppPrincipal {
	return {
		principal: {
			type: "student",
			principalId: "user_01HQ",
			displayName: "Jane Doe",
			email: "jane@example.edu",
		},
		session: {
			sessionId: "sess_01HQ",
			expiresAt: "2026-03-29T07:00:00.000Z",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		authorization: createAuthorization(),
		actor: {
			userId: "user_01HQ",
			principalId: "user_01HQ",
			principalType: "student",
			roles: ["student"],
			departments: [],
		},
	};
}

export function createConversation() {
	return {
		id: "conv_01HQ",
		ownerUserId: "user_01HQ",
		title: "图书馆开放时间",
		createdAt: "2026-03-28T07:59:00.000Z",
		updatedAt: "2026-03-28T07:59:00.000Z",
		sessionSlots: [] as Array<{
			confirmed: boolean;
			name: string;
			updatedAt: string;
			value: string;
		}>,
		messages: [] as ChatMessage[],
	};
}

export function createDeterministicIdGenerator() {
	const counters = new Map<string, number>();

	return (prefix: string) => {
		const nextValue = (counters.get(prefix) ?? 0) + 1;
		counters.set(prefix, nextValue);
		return `${prefix}_${String(nextValue).padStart(4, "0")}`;
	};
}

export function createConversationStore(input?: {
	conversation?: ReturnType<typeof createConversation>;
}) {
	const conversation = input?.conversation ?? createConversation();
	const store: ChatConversationStore = {
		createConversationDraft: vi.fn(),
		deleteConversationByOwner: vi.fn(),
		deleteConversationsByOwner: vi.fn(),
		deleteTrailingMessagesFromMessageByOwner: vi.fn(),
		getConversationByOwner: vi.fn(async (ownerUserId: string, conversationId: string) => {
			if (ownerUserId !== conversation.ownerUserId || conversationId !== conversation.id) {
				return null;
			}

			return structuredClone(conversation);
		}),
		getConversationDetailByOwner: vi.fn(),
		listConversationSummariesPageByOwner: vi.fn(),
		listConversationSummariesByOwner: vi.fn(),
	};

	return {
		conversation,
		store,
	};
}

export function createCommandStore(input?: {
	conversation?: ReturnType<typeof createConversation>;
}) {
	const conversation = input?.conversation ?? createConversation();
	const acceptedWrites: unknown[] = [];
	const finalWrites: unknown[] = [];
	const store: ChatCommandStore = {
		acceptRequest: vi.fn(async (input) => {
			acceptedWrites.push(input);
			if (input.conversationSeed) {
				conversation.id = input.conversationSeed.id;
				conversation.ownerUserId = input.conversationSeed.ownerUserId;
				conversation.createdAt = input.conversationSeed.createdAt;
			}
			conversation.title = input.conversationTitle;
			conversation.updatedAt = input.userMessage.createdAt;
			conversation.messages.push({
				...input.userMessage,
				kind: null,
				requestId: null,
				retryable: null,
				structuredParts: [],
			});
		}),
		finalizeRequest: vi.fn(async (input: FinalizeRequestWrite) => {
			finalWrites.push(input);
			conversation.updatedAt = input.assistantMessage.createdAt;
			if (input.sessionSlots) {
				const nextSlots = input.sessionSlots.map(
					(slot: FinalizeRequestWrite["sessionSlots"][number]) => ({
						...slot,
					}),
				);
				conversation.sessionSlots = nextSlots;
			}
			conversation.messages.push(input.assistantMessage);
			return structuredClone(conversation);
		}),
		findIdempotentRequest: vi.fn(async () => null),
		getAbuseControlState: vi.fn(async () => ({
			activeThrottleUntil: null,
			requestCountLastMinute: 0,
			requestCountLastTenMinutes: 0,
			shouldThrottle: false,
			throttleReason: null,
		})),
	};

	return {
		acceptedWrites,
		conversation,
		finalWrites,
		store,
	};
}

export function createTelemetryMock(): AppTelemetry {
	return {
		captureException: vi.fn(),
		configureChatRequestScope: vi.fn(),
		configureHttpRequestScope: vi.fn(),
		getTraceHeaders: vi.fn().mockReturnValue({
			baggage: "sentry-environment=test",
			sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
		}),
		markHttpResponseStatus: vi.fn(),
		recordProjectionDrain: vi.fn(),
		recordProjectionEnqueued: vi.fn(),
		recordQualitySampledGrade: vi.fn(),
		recordRequestAccepted: vi.fn(),
		recordRequestFinalized: vi.fn(),
		recordRequestTransportError: vi.fn(),
	};
}

export function expectNoInternalLocators(text: string) {
	for (const marker of ["source-faithful", "program_semester_facts:", "chunk-"]) {
		if (text.includes(marker)) {
			throw new Error(`Unexpected internal locator marker in answer: ${marker}`);
		}
	}
	if (/\[[^\]]*#[^\]]*\]/.test(text)) {
		throw new Error("Unexpected internal source locator markdown in answer.");
	}
}
