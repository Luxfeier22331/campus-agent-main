export function testPromptTrace() {
	return {
		promptId: "workflow.synthesize" as const,
		promptTemplateSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		renderedPromptSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		schemaVersion: "agent_runtime_prompt_trace.v1" as const,
	};
}

export function testToolContractFingerprint() {
	return {
		functionSchemaSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		schemaVersion: "tool_contract_fingerprint.v1" as const,
		toolsSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
	};
}
