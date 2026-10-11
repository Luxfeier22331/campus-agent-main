import { afterEach, expect, it, vi } from "vitest";
import { AgentControlClient } from "../src/control-client.ts";

afterEach(() => vi.restoreAllMocks());
it("reads the permanent application classification", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ code: "citation_validation_failed", retryable: false }, { status: 422 }),
	);
	await expect(
		new AgentControlClient("http://control", "secret").call("finalize", {}),
	).rejects.toMatchObject({ status: 422, code: "citation_validation_failed", retryable: false });
});
it("retains retryable behavior for an unclassified gateway failure", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
	await expect(
		new AgentControlClient("http://control", "secret").call("project", {}),
	).rejects.toMatchObject({ status: 503, retryable: true });
});
it("retains missing payload lookup behavior", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ code: "runtime_control_failed", retryable: true }, { status: 404 }),
	);
	await expect(
		new AgentControlClient("http://control", "secret").maybeLoad("run", "missing"),
	).resolves.toBeUndefined();
});
