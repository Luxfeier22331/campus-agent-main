import { describe, expect, it } from "vitest";

import { upsertShellConversationSummaryList } from "../src/platform/chat/runtime";

describe("platform chat runtime", () => {
  it("moves new or updated conversations to the top of the sidebar list", () => {
    expect(
      upsertShellConversationSummaryList(
        [
          {
            createdAt: "2026-04-06T09:10:00.000Z",
            id: "conv_1",
            title: "旧会话",
            updatedAt: "2026-04-06T09:10:00.000Z",
          },
          {
            createdAt: "2026-04-06T09:20:00.000Z",
            id: "conv_2",
            title: "第二个会话",
            updatedAt: "2026-04-06T09:20:00.000Z",
          },
        ],
        {
          createdAt: "2026-04-06T09:20:00.000Z",
          id: "conv_2",
          title: "第二个会话（更新）",
          updatedAt: "2026-04-06T10:00:00.000Z",
        },
      ),
    ).toEqual([
      {
        createdAt: "2026-04-06T09:20:00.000Z",
        id: "conv_2",
        title: "第二个会话（更新）",
        updatedAt: "2026-04-06T10:00:00.000Z",
      },
      {
        createdAt: "2026-04-06T09:10:00.000Z",
        id: "conv_1",
        title: "旧会话",
        updatedAt: "2026-04-06T09:10:00.000Z",
      },
    ]);
  });
});
