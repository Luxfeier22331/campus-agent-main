import { describe, expect, it, vi } from "vitest";
import { runCrawleeWithCancellation } from "../src/crawlee-cancellation";

describe("Crawlee cancellation", () => {
	it("stops the crawler and rejects when the Activity signal aborts", async () => {
		const controller = new AbortController();
		let finishRun: (() => void) | undefined;
		const crawler = {
			run: vi.fn(
				async () =>
					await new Promise<void>((resolve) => {
						finishRun = resolve;
					}),
			),
			stop: vi.fn(() => {
				finishRun?.();
			}),
		};

		const running = runCrawleeWithCancellation({
			abortSignal: controller.signal,
			crawler,
			requests: ["https://www.example.edu"],
		});
		controller.abort();

		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(crawler.stop).toHaveBeenCalledWith("Temporal Activity cancellation requested");
	});
});
