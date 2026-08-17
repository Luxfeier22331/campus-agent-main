// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const featureRoot = join(import.meta.dirname, "../src/features/conversation");

function read(relativePath: string): string {
	return readFileSync(join(featureRoot, relativePath), "utf8");
}

describe("conversation API module boundary", () => {
	it("keeps the feature API as an explicit facade", () => {
		const source = read("api.ts");

		expect(source).toContain('from "./conversation-client"');
		expect(source).toContain('from "./run-client"');
		expect(source).toContain('from "./chat-stream-errors"');
		expect(source).not.toContain("fetch(");
		expect(source).not.toContain("z.object");
	});

	it("keeps stream protocol parsing independent from HTTP routes", () => {
		const source = read("chat-stream-protocol.ts");

		expect(source).toContain('from "zod"');
		expect(source).not.toContain("/api/chat/");
		expect(source).not.toContain("requestJson");
	});

	it("keeps conversation CRUD independent from run protocol parsing", () => {
		const source = read("conversation-client.ts");

		expect(source).not.toContain("readProductSse");
		expect(source).not.toContain("runStatusResponseSchema");
		expect(source).not.toContain('from "zod"');
	});
});
