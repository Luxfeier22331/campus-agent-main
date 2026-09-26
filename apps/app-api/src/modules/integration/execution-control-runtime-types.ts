import type { Env } from "../../config";
import type { ProfileMemoryReader } from "../profile-memory";
import type { ExecutionRunMetadataWire } from "./generated/tool-execution-contract";

export type ExecutionControlRuntimeEnv = Pick<
	Env,
	| "DEPLOYMENT_ENVIRONMENT"
	| "EXECUTION_CONTROL_BASE_URL"
	| "EXECUTION_CONTROL_PRIVATE"
	| "EXECUTION_CONTROL_PRIVATE_ORIGIN"
	| "APP_API_EXECUTION_SHARED_SECRET"
>;

export type JsonRecord = Record<string, unknown>;

export interface ExecutionControlRunCreateInput {
	conversationId: string;
	metadata: ExecutionRunMetadataWire;
	ownerUserId: string;
	personalMemoryRecallAllowed: boolean;
	requestId: string;
	runtimeVersions?: JsonRecord | null;
	surface: string;
}

export interface ExecutionControlRunQuery {
	requestId: string;
	signal?: AbortSignal;
}

export interface ExecutionControlRunEventQuery {
	afterSequence?: number;
	requestId: string;
	signal?: AbortSignal;
	waitMs?: number;
}

export interface ExecutionControlRunCancelInput {
	reason: string;
	requestId: string;
}

export interface ExecutionControlOwnerDeletion {
	activeRunCount: number;
	ownerUserId: string;
	state: "draining" | "deleted";
}

export interface ExecutionControlRun {
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

export interface ExecutionControlRunEvent {
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

export interface ExecutionControlRunEventPage {
	events: ExecutionControlRunEvent[];
	nextSequence: number;
}

export interface ExecutionControlRuntimeClient {
	cancelRun(input: ExecutionControlRunCancelInput): Promise<ExecutionControlRun>;
	createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun>;
	getRun(input: ExecutionControlRunQuery): Promise<ExecutionControlRun>;
	listRunEvents(input: ExecutionControlRunEventQuery): Promise<ExecutionControlRunEventPage>;
}

export interface ExecutionControlOwnerDeletionClient {
	beginOwnerDeletion(input: { ownerUserId: string }): Promise<ExecutionControlOwnerDeletion>;
	finalizeOwnerDeletion(input: { ownerUserId: string }): Promise<ExecutionControlOwnerDeletion>;
}

export interface ExecutionControlPersonalMemoryClient extends ProfileMemoryReader {
	admit(input: import("../profile-memory").ProfileMemoryCommandPayload): Promise<void>;
	getCommandStatus(input: { commandId: string; ownerUserId: string }): Promise<{
		commandId: string;
		status: string;
		errorCode: string;
		resultFingerprint: string;
		stale: boolean;
	}>;
}
