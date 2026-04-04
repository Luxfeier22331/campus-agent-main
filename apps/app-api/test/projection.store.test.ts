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

import { createPgProjectionStore } from "../src/modules/projection/store";

describe("pg projection store", () => {
  beforeEach(() => {
    createRuntimeDatabase.mockReset();
    createRuntimeDbGetter.mockClear();
    createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
  });

  it("uses a non-persistent runtime getter so sequential reads do not share a db handle by default", async () => {
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

    const store = createPgProjectionStore({} as never);

    await store.getRequestExecution("req_01HQ");
    await store.getRequestExecution("req_02HQ");

    expect(createRuntimeDbGetter).toHaveBeenCalledTimes(1);
    expect(createRuntimeDatabase).toHaveBeenCalledTimes(2);
  });
});
