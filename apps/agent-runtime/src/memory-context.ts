import { AgentRuntimeError } from "./runtime-errors.ts";

/** Convert the internal recall response to the model-facing tool result. */
export function formatMemoryRecall(response: unknown): {
	outcome: "matched" | "no_match";
	memory_text: string;
} {
	const { facts, context_char_budget: budget } = (response ?? {}) as Record<string, unknown>;
	if (
		!(Array.isArray(facts) && facts.every((fact) => typeof fact === "string")) ||
		typeof budget !== "number" ||
		!Number.isSafeInteger(budget) ||
		budget <= 0
	) {
		throw new AgentRuntimeError("tool_contract_mismatch", "Memory recall response is invalid.", {
			operation: "tool.personal_memory_recall",
		});
	}
	if (facts.length === 0) {
		return { outcome: "no_match", memory_text: "" };
	}
	// Match the existing codepoint budget and whole-line admission policy.
	let text = "用户记忆:\n";
	let used = [...text].length;
	const append = (line: string) => {
		const length = [...line].length;
		if (used + length <= budget) {
			text += line;
			used += length;
		}
	};
	append("相关事实:\n");
	for (const fact of facts) {
		append(`- ${fact.trim()}\n`);
	}
	const memory_text = text.trim();
	return { outcome: memory_text ? "matched" : "no_match", memory_text };
}
