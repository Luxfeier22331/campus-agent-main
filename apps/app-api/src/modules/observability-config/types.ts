import type { ResolvedAppPrincipal } from "../auth";
import type { ProviderConfigActor, ProviderConfigSecretRef } from "../provider-config";

export type LlmDebugTraceMode = "off" | "langfuse_otlp";
export type RawCapturePolicyMode =
	| "eval_case"
	| "failure_triggered"
	| "manual_run_capture"
	| "off"
	| "operator_window"
	| "sampled";
export type RawCaptureSink = "langfuse_otlp" | "openai_agents_trace" | "s3_replay_packet";
export type RawCaptureField =
	| "output_schema"
	| "provider_request_body"
	| "provider_response_body"
	| "provider_stream_deltas"
	| "rendered_messages"
	| "selected_evidence_packet"
	| "selected_memory_context"
	| "tool_calls"
	| "tool_results";

export interface RawCapturePolicy {
	allowed_raw_fields: RawCaptureField[];
	allowed_sinks: RawCaptureSink[];
	approval_ref: string | null;
	audit_required: boolean;
	capture_reason: string;
	dsar_delete_linkage_required: boolean;
	mode: RawCapturePolicyMode;
	operator_principal: string | null;
	request_id: string | null;
	run_id: string | null;
	schema_version: "raw_capture_policy.v1";
	ttl_days: number;
	trace_id: string | null;
}

export interface RawCaptureRequestScope {
	requestId: string;
	runId: string;
	traceId: string;
}

export interface LlmDebugTraceConfig {
	authHeaderSecret?: ProviderConfigSecretRef;
	configId: "active";
	includeModelIo: boolean;
	mode: LlmDebugTraceMode;
	otlpEndpoint?: string;
	publicTraceBaseUrl?: string;
	rawCapturePolicy?: RawCapturePolicy;
	revision: number;
	sampleRatio: number;
	updatedAt: string;
	updatedBy: ProviderConfigActor;
}

export interface LlmDebugTraceConfigSummary {
	authHeaderConfigured: boolean;
	authHeaderFingerprint?: string;
	authHeaderLast4?: string;
	configId: "active";
	includeModelIo: boolean;
	mode: LlmDebugTraceMode;
	otlpEndpoint?: string;
	publicTraceBaseUrl?: string;
	rawCapturePolicy?: RawCapturePolicy;
	revision: number;
	sampleRatio: number;
	updatedAt: string;
	updatedBy: ProviderConfigActor;
}

export interface LlmDebugTraceRuntimeSnapshot {
	include_model_io: boolean;
	langfuse_otlp?: {
		auth_header: string;
		endpoint: string;
		public_trace_base_url?: string;
	};
	mode: LlmDebugTraceMode;
	raw_capture_policy?: RawCapturePolicy;
	sample_ratio: number;
	schema_version: "llm_debug_trace_config.v1";
}

export interface ObservabilityConfigUpdatePayload {
	authHeader?: unknown;
	includeModelIo?: unknown;
	mode?: unknown;
	otlpEndpoint?: unknown;
	publicTraceBaseUrl?: unknown;
	rawCapturePolicy?: unknown;
	sampleRatio?: unknown;
}

export interface ObservabilityConfigService {
	getConfig(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ config: LlmDebugTraceConfigSummary }>;
	getRuntimeSnapshot(input?: {
		scope?: RawCaptureRequestScope;
	}): Promise<{ config: LlmDebugTraceRuntimeSnapshot }>;
	updateConfig(input: {
		payload: ObservabilityConfigUpdatePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ config: LlmDebugTraceConfigSummary }>;
}
