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

  it("derives abuse throttle state from durable request execution truth", async () => {
    const where = vi.fn().mockResolvedValue([
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:50.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:40.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:30.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:20.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:05.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:00.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:01.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:02.000Z"),
      },
      {
        errorCode: null,
        startedAt: new Date("2026-03-28T08:05:03.000Z"),
      },
      {
        errorCode: "rate_limit_exceeded",
        startedAt: new Date("2026-03-28T08:03:00.000Z"),
      },
    ]);
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

    const state = await store.getAbuseControlState({
      now: "2026-03-28T08:06:00.000Z",
      safetyIdentifier: "safe_01HQ",
      surface: "public_chat_web",
    });

    expect(state).toEqual({
      activeThrottleUntil: "2026-03-28T08:08:00.000Z",
      requestCountLastMinute: 9,
      requestCountLastTenMinutes: 10,
      shouldThrottle: true,
      throttleReason: "active_throttle_window",
    });
  });
});
