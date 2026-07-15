export function testPromptTrace() {
	return {
		promptId: "primary_agent" as const,
		promptTemplateSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		renderedPromptSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		schemaVersion: "agent_runtime_prompt_trace.v1" as const,
	};
}

export function testToolRuntimeFingerprint() {
	return {
		combinedSha256: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
		functionSchemaSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		functionSchemaVersion: "tool-function-schemas-v2" as const,
		schemaVersion: "tool_runtime_fingerprint.v1" as const,
		toolsRegistryVersion: "test",
		toolsSchemaVersion: "tool-registry-v5" as const,
		toolsSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		workflowArtifactRegistryVersion: "test",
		workflowArtifactSchemaVersion: "workflow-artifact-registry-v2" as const,
		workflowArtifactSha256:
			"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	};
}
