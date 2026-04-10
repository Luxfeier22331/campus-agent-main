import { describe, expect, it } from "vitest";

import {
  getClearChatHistoryMutation,
  getSerializedChatHistoryKey,
} from "../src/platform/chat/history-cache";

describe("platform chat runtime", () => {
  it("reuses one serialized donor history cache key across sidebar mutations", () => {
    expect(getClearChatHistoryMutation()).toEqual({
      data: [],
      key: getSerializedChatHistoryKey(),
      options: {
        revalidate: false,
      },
    });
  });
});
