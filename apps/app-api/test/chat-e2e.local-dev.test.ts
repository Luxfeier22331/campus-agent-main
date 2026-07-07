// @vitest-environment node

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { waitForReadyzWhileChildAlive } from "../scripts/chat-e2e-local-dev";

class FakeChildProcess extends EventEmitter {
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
}

describe("chat e2e local dev lifecycle", () => {
	it("removes the child exit waiter after readiness succeeds", async () => {
		const child = new FakeChildProcess() as ChildProcess;
		const unhandledRejections: unknown[] = [];
		const onUnhandledRejection = (reason: unknown) => {
			unhandledRejections.push(reason);
		};
		process.on("unhandledRejection", onUnhandledRejection);
		try {
			await waitForReadyzWhileChildAlive("http://127.0.0.1:27014/readyz", 1000, child, {
				waitForReadyz: async () => {
					return;
				},
			});

			child.emit("exit", 0, null);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandledRejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
		}
	});
});
