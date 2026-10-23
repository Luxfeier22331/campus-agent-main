import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Hindsight owns its model configuration independently of product Model Config.
export function localHindsightEnvironment(repoRoot: string): Record<string, string> {
	const path = resolve(repoRoot, ".env");
	const local = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
	return Object.fromEntries(
		Object.entries({ ...local, ...process.env }).filter(
			(entry): entry is [string, string] =>
				/^HINDSIGHT_API_(LLM_|EMBEDDINGS_|RERANKER_|IMAGE$)/u.test(entry[0]) && Boolean(entry[1]),
		),
	);
}

export function assertLocalHindsightProviders(environment: Record<string, string>): void {
	const required = ["HINDSIGHT_API_LLM_API_KEY", "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY"];
	const missing = required.filter((key) => !environment[key]?.trim());
	if (missing.length > 0) {
		throw new Error(`Configure local Hindsight providers in .env: ${missing.join(", ")}.`);
	}
}
