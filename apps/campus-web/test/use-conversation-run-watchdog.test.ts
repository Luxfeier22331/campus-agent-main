import { describe, expect, it, vi } from "vitest";
import {
	abortableSleep,
	RESUME_BACKOFF_DELAYS_MS,
	RUN_STALL_TIMEOUT_MS,
	resumeBackoffDelayMs,
} from "../src/features/conversation/use-conversation-run-watchdog";

describe("resume backoff schedule", () => {
	it("uses each configured delay in order", () => {
		RESUME_BACKOFF_DELAYS_MS.forEach((delay, index) => {
			expect(resumeBackoffDelayMs(index + 1)).toBe(delay);
		});
	});

	it("clamps attempts beyond the schedule to the last delay", () => {
		const lastDelay = RESUME_BACKOFF_DELAYS_MS.at(-1);
		expect(resumeBackoffDelayMs(RESUME_BACKOFF_DELAYS_MS.length + 1)).toBe(lastDelay);
	});

	it("clamps non-positive attempts to the first delay", () => {
		expect(resumeBackoffDelayMs(0)).toBe(RESUME_BACKOFF_DELAYS_MS[0]);
		expect(resumeBackoffDelayMs(-3)).toBe(RESUME_BACKOFF_DELAYS_MS[0]);
	});
});

describe("abortableSleep", () => {
	it("resolves after the requested delay", async () => {
		vi.useFakeTimers();
		try {
			const slept = abortableSleep(5_000, new AbortController().signal);
			let resolved = false;
			void slept.then(() => {
				resolved = true;
			});
			await vi.advanceTimersByTimeAsync(4_999);
			expect(resolved).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await expect(slept).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects with an abort error when the signal aborts mid-sleep", async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const slept = abortableSleep(30_000, controller.signal);
			controller.abort();
			await expect(slept).rejects.toSatisfy(
				(error: unknown) => (error as { name?: string })?.name === "AbortError",
			);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(abortableSleep(1, controller.signal)).rejects.toSatisfy(
			(error: unknown) => (error as { name?: string })?.name === "AbortError",
		);
	});
});

describe("run stall timeout", () => {
	it("caps waiting at three minutes", () => {
		expect(RUN_STALL_TIMEOUT_MS).toBe(180_000);
	});
});
