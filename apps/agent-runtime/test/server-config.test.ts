import { describe, expect, it } from "vitest";
import { exactSharedSecret } from "../src/server-config.ts";

describe("agent runtime server config", () => {
	it.each([undefined, ""])("keeps an absent shared secret unconfigured", (value) => {
		expect(exactSharedSecret(value)).toBe("");
	});

	it("preserves the configured shared secret byte-for-byte", () => {
		expect(exactSharedSecret("secret-value")).toBe("secret-value");
	});

	it.each([" secret-value", "secret-value ", "secret-value\n", "\tsecret-value"])(
		"rejects surrounding whitespace in a configured shared secret",
		(value) => {
			expect(() => exactSharedSecret(value)).toThrow(
				"EXECUTION_AGENT_RUNTIME_SHARED_SECRET must not contain surrounding whitespace",
			);
		},
	);
});
