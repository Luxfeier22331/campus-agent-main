import { describe, expect, it, vi } from "vitest";
import { logAgentRuntimeEvent, safeAgentRuntimeErrorCode } from "../src/safe-logging.ts";

describe("agent runtime safe logging", () => {
	it("writes one JSON object without raw error text", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const error = Object.assign(new Error("secret request body"), { code: "upstream_timeout" });

		logAgentRuntimeEvent("error", "agent_runtime.request", "failed", {
			error_code: safeAgentRuntimeErrorCode(error),
			source: "http",
		});

		expect(spy).toHaveBeenCalledOnce();
		const event = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
		expect(event).toEqual({
			error_code: "upstream_timeout",
			event_type: "agent_runtime.request",
			level: "error",
			source: "http",
			status: "failed",
		});
		expect(JSON.stringify(event)).not.toContain("secret request body");
		spy.mockRestore();
	});
});
