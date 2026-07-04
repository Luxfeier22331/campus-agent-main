export type LlmDebugTraceMode = "langfuse_otlp" | "off";

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
	updatedBy: {
		displayName: string;
		principalId: string;
	};
}

export interface LlmDebugTraceConfigUpdatePayload {
	authHeader?: string;
	includeModelIo?: false;
	mode: LlmDebugTraceMode;
	otlpEndpoint?: string;
	publicTraceBaseUrl?: string;
	sampleRatio: number;
}
