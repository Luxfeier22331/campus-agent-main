import { expect, it, vi } from "vitest";
import { runTaskPool } from "../src/task-pool.ts";

it("runs tasks discovered after workers start with an empty queue", async () => {
	const ran: number[] = [];
	await runTaskPool<number>(
		[],
		2,
		async (push) => {
			for (const task of [1, 2, 3]) {
				await new Promise((resolve) => setTimeout(resolve, 1));
				push(task);
			}
		},
		async (task) => {
			ran.push(task);
		},
	);
	expect(ran.sort()).toEqual([1, 2, 3]);
});

it("runs initial tasks before discovered ones and bounds concurrency", async () => {
	const ran: string[] = [];
	let active = 0;
	let peak = 0;
	await runTaskPool<string>(
		["a", "b", "c"],
		2,
		async (push) => {
			push("d");
		},
		async (task) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			ran.push(task);
			active--;
		},
	);
	expect(ran).toHaveLength(4);
	expect(ran.indexOf("d")).toBeGreaterThan(ran.indexOf("a"));
	expect(peak).toBe(2);
});

it("releases waiting workers when discovery fails", async () => {
	await expect(
		runTaskPool<number>(
			[],
			2,
			async () => {
				throw new Error("discovery failed");
			},
			vi.fn(),
		),
	).rejects.toThrow("discovery failed");
});
