// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { captureProfileMemorySnapshotForUpdate } from "../src/modules/profile-memory/snapshot";

function createTransaction(settingsRows: unknown[]) {
	const forUpdate = vi.fn().mockResolvedValue(settingsRows);
	const limit = vi.fn(() => ({ for: forUpdate }));
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	return {
		forUpdate,
		transaction: { select } as never,
	};
}

describe("profile memory accepted-request snapshot", () => {
	it("locks settings and returns the active defaults when no row exists", async () => {
		const { forUpdate, transaction } = createTransaction([]);

		await expect(captureProfileMemorySnapshotForUpdate(transaction, "user_01HQ")).resolves.toEqual({
			appendEnabled: true,
			ownerGeneration: 1,
			recallEnabled: true,
		});
		expect(forUpdate).toHaveBeenCalledWith("update");
	});

	it("freezes the persisted generation and disabled runtime state", async () => {
		const { transaction } = createTransaction([
			{
				commandSequence: 7,
				generation: 3,
				lifecycleState: "paused",
				syncStatus: "synced",
			},
		]);

		await expect(captureProfileMemorySnapshotForUpdate(transaction, "user_01HQ")).resolves.toEqual({
			appendEnabled: false,
			ownerGeneration: 3,
			recallEnabled: false,
		});
	});

	it("does not expose runtime memory while an active lifecycle command failed", async () => {
		const { transaction } = createTransaction([
			{
				commandSequence: 8,
				generation: 3,
				lifecycleState: "active",
				syncStatus: "failed",
			},
		]);

		await expect(captureProfileMemorySnapshotForUpdate(transaction, "user_01HQ")).resolves.toEqual({
			appendEnabled: false,
			ownerGeneration: 3,
			recallEnabled: false,
		});
	});
});
