import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("agent runtime worker env contract", () => {
	it("uses one secret for agent-control projection calls", () => {
		const source = readServerSource();

		expect(source).toContain("AGENT_CONTROL_BASE_URL");
		expect(source.match(/required\("AGENT_CONTROL_RUNTIME_SHARED_SECRET"\)/gu)).toHaveLength(1);
		expect(source).not.toContain("process.env.AGENT_CONTROL_BASE_URL");
		expect(source).not.toContain("process.env.AGENT_RUNTIME_SHARED_SECRET");
		expect(source).not.toContain("process.env.AGENT_RUNTIME_AGENT_CONTROL_SHARED_SECRET");
	});

	it("does not project root provider env into the OpenAI Agents SDK provider", () => {
		const source = readServerSource();

		expect(source).not.toContain("createOpenAIAgentsRunnerFromEnv");
		expect(source).not.toContain("OPENAI_API_KEY");
	});
});

function readServerSource(): string {
	return readFileSync(fileURLToPath(new URL("../src/worker.ts", import.meta.url)), "utf8");
}
