import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAnswerTiming } from "../src/features/conversation/browser-answer-timing";

describe("foreground answer timing", () => {
	let timing: BrowserAnswerTiming;
	let now = 2000000;
	let frames: FrameRequestCallback[];
	const fetchMock = vi.fn();
	beforeEach(() => {
		now = 2000000;
		frames = [];
		document.body.innerHTML = "";
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		vi.spyOn(performance, "now").mockImplementation(() => now);
		vi.stubGlobal("CSS", { escape: (value: string) => value });
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			frames.push(callback),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		fetchMock.mockReset().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);
		timing = new BrowserAnswerTiming();
	});
	afterEach(() => {
		timing.cancel();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});
	async function commitText() {
		document.body.innerHTML = '<div data-answer-message-id="answer-1">答案第一段</div>';
		await Promise.resolve();
	}
	function paint() {
		frames.shift()?.(now);
		now += 16;
		frames.shift()?.(now);
	}
	it("uses one submission clock and waits for text DOM commit plus a paint opportunity", async () => {
		timing.start();
		now += 100;
		timing.accept("request-1");
		now += 900;
		timing.receive("request-1", "answer-1");
		expect(frames).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
		now += 20;
		await commitText();
		expect(fetchMock).not.toHaveBeenCalled();
		paint();
		expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
			"/api/chat/requests/request-1/client-timing",
			expect.objectContaining({
				body: JSON.stringify({ firstDeltaMs: 1000, firstRenderMs: 1036 }),
			}),
		);
		timing.receive("request-1", "answer-1");
		timing.accept("request-1");
		timing.receive("request-1", "answer-1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("ignores page recovery, history and another request", async () => {
		timing.accept("request-1");
		timing.receive("request-1", "answer-1");
		timing.start();
		timing.accept("request-2");
		timing.receive("request-1", "answer-1");
		await commitText();
		paint();
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("keeps the original clock when the same accepted request reconnects", async () => {
		timing.start();
		timing.accept("request-1");
		now += 4000;
		timing.accept("request-1");
		timing.receive("request-1", "answer-1");
		await commitText();
		paint();
		expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).firstDeltaMs).toBe(4000);
	});
	it("does not report a foreground request that becomes hidden before paint", async () => {
		timing.start();
		timing.accept("request-1");
		timing.receive("request-1", "answer-1");
		await commitText();
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		paint();
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("does not start timing a background submission", async () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		timing.start();
		timing.accept("request-1");
		timing.receive("request-1", "answer-1");
		await commitText();
		paint();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
