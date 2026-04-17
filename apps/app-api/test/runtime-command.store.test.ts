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

import { createPgChatCommandStore } from "../src/modules/runtime-command/store";

describe("pg chat command store", () => {
  beforeEach(() => {
    createRuntimeDatabase.mockReset();
    createRuntimeDbGetter.mockClear();
    createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
  });

  it("uses a non-persistent runtime getter so sequential idempotency lookups do not share a db handle by default", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({
      limit,
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

    const store = createPgChatCommandStore({} as never);

    await store.findIdempotentRequest({
      actorUserId: "user_01HQ",
      idempotencyKey: "idem-01",
    });
    await store.findIdempotentRequest({
      actorUserId: "user_02HQ",
      idempotencyKey: "idem-02",
    });

    expect(createRuntimeDbGetter).toHaveBeenCalledTimes(1);
    expect(createRuntimeDatabase).toHaveBeenCalledTimes(2);
  });
});
