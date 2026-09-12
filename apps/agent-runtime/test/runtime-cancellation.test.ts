import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeCancellation, waitForRuntimeWork } from "../src/runtime-cancellation.ts";
import { deferred } from "./helpers/deferred.ts";

afterEach(() => vi.useRealTimers());

describe("runtime cancellation", () => {
	it.each(["success", "failure"])(
		"keeps an earlier %s and releases its deadline",
		async (outcome) => {
			vi.useFakeTimers();
			const scope = createRuntimeCancellation(new AbortController().signal, 100);
			const failure = new Error("provider failure before deadline");
			const result = waitForRuntimeWork(scope.signal, async () => {
				if (outcome === "failure") {
					throw failure;
				}
				return "completed answer";
			});
			if (outcome === "success") {
				await expect(result).resolves.toBe("completed answer");
			} else {
				await expect(result).rejects.toBe(failure);
			}
			scope.dispose();
			await vi.advanceTimersByTimeAsync(1000);
			expect(scope.deadlineSignal.aborted).toBe(false);
			expect(vi.getTimerCount()).toBe(0);
		},
	);
	it("ends waiting even when work never settles", async () => {
		vi.useFakeTimers();
		const scope = createRuntimeCancellation(new AbortController().signal, 100);
		const result = waitForRuntimeWork(scope.signal, () => new Promise<never>(() => undefined));
		const check = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
		await vi.advanceTimersByTimeAsync(100);
		await check;
		expect(scope.deadlineSignal.aborted).toBe(true);
		scope.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(["resolve", "reject"])(
		"consumes late %s without changing cancellation",
		async (outcome) => {
			const scope = createRuntimeCancellation(new AbortController().signal, 10000);
			const late = deferred<string>();
			const result = waitForRuntimeWork(scope.signal, () => late.promise);
			scope.cancel();
			await expect(result).rejects.toMatchObject({ name: "AbortError" });
			if (outcome === "resolve") {
				late.resolve("late answer");
			} else {
				late.reject(new Error("late failure"));
			}
			await expect(result).rejects.toMatchObject({ name: "AbortError" });
		},
	);

	it("does not relabel a disconnect when the original deadline passes", async () => {
		vi.useFakeTimers();
		const parent = new AbortController();
		const scope = createRuntimeCancellation(parent.signal, 100);
		const result = waitForRuntimeWork(scope.signal, () => new Promise<never>(() => undefined));
		const reason = new Error("client disconnected");
		parent.abort(reason);
		await expect(result).rejects.toBe(reason);
		await vi.advanceTimersByTimeAsync(1000);
		expect(scope.deadlineSignal.aborted).toBe(false);
		scope.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("never starts work after cancellation, and removes listeners after success or failure", async () => {
		const parent = new AbortController();
		const add = vi.spyOn(parent.signal, "addEventListener");
		const remove = vi.spyOn(parent.signal, "removeEventListener");
		await expect(waitForRuntimeWork(parent.signal, async () => "answer")).resolves.toBe("answer");
		const failure = new Error("failed");
		await expect(
			waitForRuntimeWork(parent.signal, () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		parent.abort(failure);
		const work = vi.fn(async () => "not called");
		await expect(waitForRuntimeWork(parent.signal, work)).rejects.toBe(failure);
		expect(work).not.toHaveBeenCalled();
		expect(add).toHaveBeenCalledTimes(2);
		expect(remove).toHaveBeenCalledTimes(2);
	});
});
