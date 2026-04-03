// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntimeDatabase } = vi.hoisted(() => ({
  createRuntimeDatabase: vi.fn(),
}));

vi.mock("../src/db/runtime", () => ({
  createRuntimeDatabase,
}));

import { createPgProjectionStore } from "../src/modules/projection/store";

describe("pg projection store", () => {
  beforeEach(() => {
    createRuntimeDatabase.mockReset();
  });

  it("reuses one runtime database handle across sequential store reads", async () => {
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

    expect(createRuntimeDatabase).toHaveBeenCalledTimes(1);
  });
});
