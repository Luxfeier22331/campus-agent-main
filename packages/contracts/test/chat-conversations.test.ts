import { describe, expect, it } from "vitest";
import { OpsConversationListQuerySchema } from "../src/chat-conversations";

describe("conversation failure filter", () => {
	it.each([
		[undefined, undefined],
		[true, true],
		[false, false],
		["true", true],
		["false", false],
	])("parses %s as %s", (input, expected) => {
		expect(OpsConversationListQuerySchema.parse({ hasFailures: input }).hasFailures).toBe(expected);
	});
	it.each(["", "0", "1", "FALSE", "yes", 0, 1, null])("rejects %s", (hasFailures) => {
		expect(OpsConversationListQuerySchema.safeParse({ hasFailures }).success).toBe(false);
	});
});
