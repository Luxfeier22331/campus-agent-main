import type { ExecutionActorContext, ExecutionAuthorizationContext } from "../auth";
import type { TracePropagationHeaders } from "../telemetry/trace";
import type { VersionQuery } from "../version-query";
import type { ExecutionFinalizationStatus } from "./execution-finalization-contract";

export type RequestedScope = string;

export interface ToolRuntimeFingerprint {
	combinedSha256: string;
	functionSchemaSha256: string;
	functionSchemaVersion: string;
	schemaVersion: "tool_runtime_fingerprint.v1";
	toolsRegistryVersion: string;
	toolsSchemaVersion: string;
	toolsSha256: string;
	workflowArtifactRegistryVersion: string;
	workflowArtifactSchemaVersion: string;
	workflowArtifactSha256: string;
}

export interface ToolExecutionModelParamsProjection {
	paramsSchemaVersion: string;
	paramsSha256: string;
	projectedParams: {
		maxOutputTokens?: number | null;
		reasoningEffort?: "high" | "low" | "medium" | "minimal" | "none" | "xhigh" | null;
		responseFormat?: "json_object" | "json_schema" | "text" | null;
		store?: boolean | null;
		temperature?: number | null;
		textVerbosity?: "high" | "low" | "medium" | null;
		toolChoice?: "auto" | "none" | "required" | "tool_name" | null;
		topP?: number | null;
	};
	schemaVersion: "model_params_projection.v1";
}

export interface ToolExecutionPromptRegistryAttestation {
	attestationSha256: string;
	outputSchemaId: string;
	promptId: string;
	promptRegistryVersion: string;
	promptTemplateSha256: string;
	promptVariablesSchemaVersion: string;
	schemaVersion: "prompt_registry_attestation.v1";
}

export interface ToolExecutionProviderRequestSafeHash {
	canonicalization: "canonical_json_redacted_v1";
	redactionPolicy: "llm_provider_request_safe_projection.v1";
	requestSha256: string;
	schemaVersion: "provider_request_safe_hash.v1";
}

export interface ToolExecutionToolRuntimeAttestation {
	attestedBy: string;
	combinedSha256: string;
	configRefs: [
		"configs/runtime/tools.v4.json",
		"configs/runtime/tool-function-schemas.v1.json",
		"configs/runtime/workflow-artifacts.v2.json",
	];
	functionSchemaVersion: string;
	schemaVersion: "tool_runtime_attestation.v1";
	toolsRegistryVersion: string;
	workflowArtifactRegistryVersion: string;
}

export interface ToolExecutionPrimaryAttestation {
	attestationKind: "primary_agent_call";
	attestationSha256: string;
	attestedBy: string;
	schemaVersion: "primary_attestation.v1";
}

export interface ToolExecutionLlmIoFingerprint {
	contextEnvelopeSha256: string;
	evidencePacketSha256: string;
	llmCallSite: "agent.primary";
	memorySelectionSha256: string;
	model: string;
	modelParamsHash: string;
	modelParamsProjection: ToolExecutionModelParamsProjection;
	outputSchemaId: string;
	primaryAttestation: ToolExecutionPrimaryAttestation;
	promptId: string;
	promptRegistryAttestation: ToolExecutionPromptRegistryAttestation;
	promptTemplateSha256: string;
	promptVariablesSchemaVersion: string;
	provider: string;
	providerProfileRevision: string;
	providerRequestSafeHash: ToolExecutionProviderRequestSafeHash;
	renderedPromptSha256: string;
	requestId: string;
	runId: string;
	runtimeRelease: string;
	schemaVersion: "llm_io_fingerprint.v1";
	toolCatalogSha256: string;
	toolRuntimeAttestation: ToolExecutionToolRuntimeAttestation;
	toolRuntimeFingerprint: ToolRuntimeFingerprint;
	toolSchemaSha256: string;
	traceId: string;
	workflowArtifactSha256: string;
}

export interface ToolExecutionAnswerEvalFingerprint {
	answerFingerprintSha256: string;
	branchIdentity: {
		branchKind:
			| "clarification"
			| "direct_no_tool"
			| "policy_refusal"
			| "runtime_error"
			| "tool_routed";
		promptId: string;
		schemaVersion: "answer_branch_identity.v1";
		workflowMode: string;
	};
	evidenceReplayIndexSha256?: string | null;
	llmCallSite: "agent.primary";
	llmIoFingerprintSha256: string;
	outputSchemaId: string;
	providerProfileRevision: string;
	requestId: string;
	runId: string;
	runtimeRelease: string;
	schemaVersion: "answer_eval_fingerprint.v1";
	selectedTool: string | null;
	selectedTools: string[];
	stageTimingProfileSha256: string;
	terminalOutcome: string;
	toolRuntimeCombinedSha256: string;
	traceId: string;
}

export interface ToolExecutionSessionSlot {
	confirmed?: boolean;
	name: string;
	value: string;
}

export interface ToolExecutionSessionUpdate {
	upsertSlots: Array<{
		confirmed: true;
		name: "curriculum_program" | "curriculum_program_family" | "curriculum_semester";
		value: string;
	}>;
}

export interface ToolExecutionSelectedNoticeRef {
	noticeId: string;
	sourceFamily?: string;
	targetSurface?: string;
	title?: string;
}

export interface ToolExecutionSessionSummary {
	confirmedSlots: ToolExecutionSessionSlot[];
	selectedNoticeRef?: ToolExecutionSelectedNoticeRef | null;
	turnCount: number;
}

export interface ToolExecutionMemorySummary {
	enabled: boolean;
}

export interface ToolExecutionConversationMessage {
	content: string;
	createdAt: string;
	messageId: string;
	role: "assistant" | "user";
}

export interface ToolExecutionPreviousEvidenceRef {
	accessScope: string;
	collection?: string;
	contentHash: string;
	documentId?: string;
	evidenceId: string;
	evidenceRole?: string;
	sectionTitle?: string;
	snapshotId?: string;
	sourceId: string;
	sourceKind?: string;
	snippet?: string;
	title?: string;
	versionId?: string;
}

export interface ToolExecutionPreviousToolResultRef {
	tool: string;
	contentHash: string;
	projectionRef: string;
	requestId: string;
	resultKind: string;
	runId: string;
	status: string;
	summary?: string;
}

export interface ToolExecutionConversationContext {
	conversationId: string;
	currentUserMessage: {
		content: string;
		createdAt: string;
		role: "user";
	};
	parentMessageId: string | null;
	previousToolResults: ToolExecutionPreviousToolResultRef[];
	previousEvidenceRefs: ToolExecutionPreviousEvidenceRef[];
	recentTurns: ToolExecutionConversationMessage[];
	schemaVersion: "conversation_context.v1";
	sessionState: ToolExecutionSessionSummary;
	userMessageId: string;
}

export interface ToolExecutionContextProjection {
	actor: ExecutionActorContext;
	authorization: ExecutionAuthorizationContext;
	conversation?: ToolExecutionConversationContext;
	memory?: ToolExecutionMemorySummary;
	session: ToolExecutionSessionSummary;
}

export interface ToolExecutionInput {
	context: ToolExecutionContextProjection;
	conversationId: string;
	requestId: string;
	requestedTool?: string | null;
	requestedScope?: RequestedScope | null;
	safetyIdentifier?: string | null;
	surface?: string;
	tenantId?: string | null;
	traceHeaders?: TracePropagationHeaders;
	traceId: string;
	userGoal: string;
	versionQuery?: VersionQuery | null;
}

export interface ToolExecutionObservability {
	agentRuntime: string | null;
	answerEvalFingerprint?: ToolExecutionAnswerEvalFingerprint | null;
	llmIoFingerprint?: ToolExecutionLlmIoFingerprint | null;
	selectedTools: string[];
	terminalReason: string | null;
}

export interface ToolExecutionWorkflowTraceSummary {
	answerArtifactKinds: string[];
	answerArtifactRefs: string[];
	directVsDelegateBranch: string | null;
	firstDecisionActor: string | null;
	planningOutcome: string | null;
	runtimeVersions: Record<string, unknown>;
	selectedTool: string | null;
	selectedTools: string[];
	terminalReason: string | null;
	traceSteps?: Record<string, unknown>[];
	toolCallSummaries?: Record<string, unknown>[];
	workflowMode: string | null;
}

export interface ToolExecutionResponse {
	answerText: string;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	} | null;
	followUpQuestion: string;
	observability?: ToolExecutionObservability | null;
	resolvedScope: RequestedScope | null;
	result: unknown;
	selectedTool: string | null;
	sessionUpdate: ToolExecutionSessionUpdate | null;
	stageTiming?: Record<string, unknown>;
	status: ExecutionFinalizationStatus;
	traceId: string;
	workflowTraceSummary?: ToolExecutionWorkflowTraceSummary | null;
}

export interface ToolExecutionClient {
	execute(input: ToolExecutionInput): Promise<ToolExecutionResponse>;
	executeStream?(input: ToolExecutionInput): Promise<Response>;
}
