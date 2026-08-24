export interface ToolExecutionWorkflowTraceSummary {
	answerArtifactRefs: string[];
	executionPath: "direct" | "tool_assisted";
	runtimeVersions: Record<string, unknown>;
	terminalReason: string;
}
