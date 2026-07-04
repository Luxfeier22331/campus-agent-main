import type { ResolvedAppPrincipal } from "../auth";
import type { ProviderConfigActor, ProviderConfigSecretRef } from "../provider-config";

export type LlmDebugTraceMode = "off" | "langfuse_otlp";

export interface LlmDebugTraceConfig {
	authHeaderSecret?: ProviderConfigSecretRef;
	configId: "active";
	includeModelIo: boolean;
	mode: LlmDebugTraceMode;
	otlpEndpoint?: string;
	publicTraceBaseUrl?: string;
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
	sample_ratio: number;
	schema_version: "llm_debug_trace_config.v1";
}

export interface ObservabilityConfigUpdatePayload {
	authHeader?: unknown;
	includeModelIo?: unknown;
	mode?: unknown;
	otlpEndpoint?: unknown;
	publicTraceBaseUrl?: unknown;
	sampleRatio?: unknown;
}

export interface ObservabilityConfigService {
	getConfig(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ config: LlmDebugTraceConfigSummary }>;
	getRuntimeSnapshot(): Promise<{ config: LlmDebugTraceRuntimeSnapshot }>;
	updateConfig(input: {
		payload: ObservabilityConfigUpdatePayload;
		principal: ResolvedAppPrincipal;
	}): Promise<{ config: LlmDebugTraceConfigSummary }>;
}
