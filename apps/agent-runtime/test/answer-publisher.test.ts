import { afterEach, expect, it, vi } from "vitest";
import { createAnswerPublisher } from "../src/answer-publisher.ts";
import { AgentControlClient, ControlHTTPError } from "../src/control-client.ts";

const delta = { request_id: "r", invocation_id: "r:answer", answer_index: 1, delta: "你好" };
afterEach(() => vi.restoreAllMocks());
function fixture() {
	const control = new AgentControlClient("http://control", "test");
	const call = vi.spyOn(control, "call");
	const cancellation = new AbortController();
	const onUnavailable = vi.fn();
	const publish = createAnswerPublisher({ control, signal: cancellation.signal, onUnavailable });
	return { call, cancellation, publish, onUnavailable };
}
it.each([
	new TypeError("fetch failed"),
	new ControlHTTPError("answer/delta", 503),
	new ControlHTTPError("answer/delta", 429),
])("stops only this publisher after a temporary failure: %s", async (error) => {
	const f = fixture();
	f.call.mockRejectedValue(error);
	await f.publish(delta);
	await f.publish({ ...delta, answer_index: 2 });
	expect(f.call).toHaveBeenCalledTimes(1);
	expect(f.onUnavailable).toHaveBeenCalledTimes(1);
});
it.each([
	new ControlHTTPError("answer/delta", 401),
	new ControlHTTPError("answer/delta", 422, { retryable: false }),
	new SyntaxError("invalid response"),
	new ControlHTTPError("answer/delta", 503, { retryable: false }),
])("preserves contract failures: %s", async (error) => {
	const f = fixture();
	f.call.mockRejectedValue(error);
	await expect(f.publish(delta)).rejects.toBe(error);
	expect(f.onUnavailable).not.toHaveBeenCalled();
});
it.each([false, true])(
	"cancellation takes precedence over a failed delivery (alreadyStopped=%s)",
	async (stopped) => {
		const f = fixture();
		if (stopped) {
			f.call.mockRejectedValue(new TypeError("offline"));
			await f.publish(delta);
		}
		f.call.mockImplementation(
			async (_action, _data, signal) =>
				new Promise((_resolve, reject) =>
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
				),
		);
		if (stopped) {
			f.cancellation.abort();
		}
		const pending = f.publish(delta);
		f.cancellation.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	},
);
it("bounds a stalled delivery to one second and disables subsequent sends", async () => {
	const f = fixture();
	f.call.mockImplementation(
		async (_action, _data, signal) =>
			new Promise((_resolve, reject) =>
				signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
			),
	);
	const start = performance.now();
	await f.publish(delta);
	await f.publish({ ...delta, answer_index: 2 });
	expect(performance.now() - start).toBeLessThan(2500);
	expect(f.call).toHaveBeenCalledTimes(1);
	expect(f.onUnavailable).toHaveBeenCalledTimes(1);
});
