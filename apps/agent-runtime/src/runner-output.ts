import type { AgentRunnerResult, WorkflowOperation } from "./agent-run-contract.ts";
export function partialJSONStringField(serialized: string, field: string): string | undefined {
	const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"`, "u");
	const match = fieldPattern.exec(serialized);
	if (!match) {
		return undefined;
	}
	const start = match.index + match[0].length;
	let value = "";
	for (let index = start; index < serialized.length; index += 1) {
		const character = serialized[index];
		if (character === '"') {
			return value;
		}
		if (character !== "\\") {
			value += character;
			continue;
		}
		if (index + 1 >= serialized.length) {
			return value;
		}
		const escapeCharacter = serialized[index + 1];
		if (escapeCharacter === undefined) {
			return value;
		}
		switch (escapeCharacter) {
			case '"':
			case "\\":
			case "/":
				value += escapeCharacter;
				index += 1;
				break;
			case "b":
				value += "\b";
				index += 1;
				break;
			case "f":
				value += "\f";
				index += 1;
				break;
			case "n":
				value += "\n";
				index += 1;
				break;
			case "r":
				value += "\r";
				index += 1;
				break;
			case "t":
				value += "\t";
				index += 1;
				break;
			case "u": {
				const hex = serialized.slice(index + 2, index + 6);
				if (!/^[0-9a-f]{4}$/iu.test(hex)) {
					return value;
				}
				value += String.fromCharCode(Number.parseInt(hex, 16));
				index += 5;
				break;
			}
			default:
				return value;
		}
	}
	return value;
}

export function normalizedModelOutput(
	value: unknown,
	operation: WorkflowOperation,
): Pick<AgentRunnerResult, "finalOutput" | "structuredOutput"> {
	const output =
		operation === "solve" && value && typeof value === "object" && "result" in value
			? value.result
			: value;
	return {
		finalOutput:
			typeof output === "string"
				? output
				: operation === "solve"
					? output &&
						typeof output === "object" &&
						"answer" in output &&
						typeof output.answer === "string"
						? output.answer
						: ""
					: (JSON.stringify(output) ?? ""),
		...(output && typeof output === "object" ? { structuredOutput: output } : {}),
	};
}
