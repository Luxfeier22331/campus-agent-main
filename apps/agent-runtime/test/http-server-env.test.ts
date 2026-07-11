import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("agent runtime server env contract", () => {
	it("uses AGENT_RUNTIME-prefixed env names for execution-control internal query config", () => {
		const source = readServerSource();

		expect(source).toContain("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL");
		expect(source).toContain("AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET");
		expect(source).not.toContain("process.env.EXECUTION_CONTROL_BASE_URL");
		expect(source).not.toContain("process.env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET");
	});

	it("does not project root provider env into the OpenAI Agents SDK provider", () => {
		const source = readServerSource();

		expect(source).not.toContain("createOpenAIAgentsRunnerFromEnv");
		expect(source).not.toContain("OPENAI_API_KEY");
	});

	it("does not use agent-runtime env for LLM debug trace config", () => {
		const source = readServerSource();

		expect(source).not.toContain("AGENT_RUNTIME_LLM_DEBUG");
	});
});

function readServerSource(): string {
	return readFileSync(fileURLToPath(new URL("../src/server.ts", import.meta.url)), "utf8");
}
