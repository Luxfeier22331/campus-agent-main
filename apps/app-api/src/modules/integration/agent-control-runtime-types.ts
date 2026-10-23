import type { ProfileMemoryReader } from "../profile-memory";
import type { ClusterPrivateEnv } from "./cluster-private-transport";
import type { ExecutionRunMetadataWire } from "./generated/tool-execution-contract";

export type AgentControlRuntimeEnv = ClusterPrivateEnv;

export type JsonRecord = Record<string, unknown>;

export interface AgentControlRunCreateInput {
	conversationId: string;
	metadata: ExecutionRunMetadataWire;
	ownerUserId: string;
	personalMemoryRecallAllowed: boolean;
	requestId: string;
	runtimeVersions?: JsonRecord | null;
	surface: string;
}

export interface AgentControlRunQuery {
	requestId: string;
	signal?: AbortSignal;
}

export interface AgentControlRunEventQuery {
	afterAnswerIndex?: number;
	afterSequence?: number;
	requestId: string;
	signal?: AbortSignal;
	waitMs?: number;
}

export interface AgentControlRunCancelInput {
	reason: string;
	requestId: string;
}

export interface AgentControlOwnerDeletion {
	activeRunCount: number;
	ownerUserId: string;
	state: "draining" | "deleted";
}

export interface AgentControlRun {
	admittedAt: string;
	completedAt: string;
	conversationId: string;
	createdAt: string;
	failCloseReason: string;
	finalResponseRef: string;
	ownerUserId: string;
	queuedAt: string;
	requestId: string;
	startedAt: string;
	status: string;
	streamingStartedAt: string;
	surface: string;
	taskQueue: string;
	terminalReason: string;
	updatedAt: string;
}

export interface AgentControlRunEvent {
	answerIndex?: never;
	conversationId: string;
	eventId: string;
	eventType: string;
	occurredAt: string;
	payload: JsonRecord;
	payloadSchemaVersion: string;
	requestId: string;
	sequence: number;
	visibility: string;
}

export interface AgentControlAnswerDelta {
	requestId: string;
	messageId: string;
	index: number;
	delta: string;
	occurredAt: string;
}
export interface AgentControlRunEventPage {
	answerDeltas?: AgentControlAnswerDelta[];
	events: AgentControlRunEvent[];
	nextSequence: number;
}

export interface AgentControlRuntimeClient {
	cancelRun(input: AgentControlRunCancelInput): Promise<AgentControlRun>;
	createRun(input: AgentControlRunCreateInput): Promise<AgentControlRun>;
	getRun(input: AgentControlRunQuery): Promise<AgentControlRun>;
	listRunEvents(input: AgentControlRunEventQuery): Promise<AgentControlRunEventPage>;
}

export interface AgentControlOwnerDeletionClient {
	beginOwnerDeletion(input: { ownerUserId: string }): Promise<AgentControlOwnerDeletion>;
	finalizeOwnerDeletion(input: { ownerUserId: string }): Promise<AgentControlOwnerDeletion>;
}

export interface AgentControlPersonalMemoryClient extends ProfileMemoryReader {
	admit(input: import("../profile-memory").ProfileMemoryCommandPayload): Promise<void>;
	getCommandStatus(input: { commandId: string; ownerUserId: string }): Promise<{
		commandId: string;
		status: string;
		errorCode: string;
		stale: boolean;
	}>;
}
