import { fileURLToPath } from "node:url";
import type { SdkToolRuntime } from "../../src/agent-run-contract.ts";
import { formatMemoryRecall } from "../../src/memory-context.ts";
import { loadToolCatalog } from "../../src/tool-catalog.ts";

export const recalledMemory = {
	outcome: "matched",
	memory_text: "用户记忆:\n相关事实:\n- 喜欢安静😀",
};
export function memoryRecallTool(): SdkToolRuntime {
	const catalog = loadToolCatalog(
		fileURLToPath(new URL("../../../../configs/runtime/tools.v7.json", import.meta.url)),
	);
	const tool = catalog.tools.find((entry) => entry.name === "personal_memory_recall");
	if (!tool) {
		throw new Error("missing memory tool");
	}
	return {
		name: tool.name,
		description: tool.description,
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: { query: { type: "string" } },
			required: ["query"],
		},
		execute: async () => ({
			status: "completed",
			result: formatMemoryRecall({ facts: ["喜欢安静😀"], context_char_budget: 2500 }),
		}),
	};
}
