// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));

import { createPgChatConversationStore } from "../src/modules/chat/store";

describe("pg chat conversation store", () => {
	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("builds a non-persistent runtime getter so sequential reads do not share a db handle by default", async () => {
		const limit = vi.fn().mockResolvedValue([]);
		const orderBy = vi.fn(() => ({
			limit,
		}));
		const where = vi.fn(() => ({
			orderBy,
		}));
		const from = vi.fn(() => ({
			where,
		}));
		const select = vi.fn(() => ({
			from,
		}));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgChatConversationStore({} as never);

		await store.listConversationSummariesByOwner({
			limit: 50,
			ownerUserId: "user_01HQ",
			view: "active",
		});
		await store.listConversationSummariesByOwner({
			limit: 50,
			ownerUserId: "user_02HQ",
			view: "active",
		});

		expect(createRuntimeDbGetter).toHaveBeenCalledTimes(1);
		expect(createRuntimeDatabase).toHaveBeenCalledTimes(2);
	});
});
