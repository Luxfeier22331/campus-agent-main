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
		functionSchemaVersion: "tool-function-schemas-v3" as const,
		runtimeRelease: "test-release",
		schemaVersion: "tool_runtime_fingerprint.v2" as const,
		toolsRegistryVersion: "test",
		toolsSchemaVersion: "tool-registry-v6" as const,
		toolsSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
	};
}
