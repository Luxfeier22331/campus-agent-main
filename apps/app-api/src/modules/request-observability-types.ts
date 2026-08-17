export interface ToolExecutionWorkflowTraceSummary {
	answerArtifactRefs: string[];
	executionPath: "direct" | "tool_assisted" | "clarification" | "rejected" | "unsupported";
	runtimeVersions: Record<string, unknown>;
	terminalReason: string;
}
