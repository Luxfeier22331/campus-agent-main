import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const dockerfile = readFileSync(join(repoRoot, "apps/agent-runtime/Dockerfile"), "utf8");

describe("agent-runtime Dockerfile", () => {
	it("packages every runtime registry file loaded by the tool catalog", () => {
		for (const configPath of [
			"configs/runtime/tools.v8.json",
			"configs/runtime/tool-function-schemas.v4.json",
		]) {
			expect(dockerfile).toContain(`${configPath} ./${configPath}`);
		}
	});
});
