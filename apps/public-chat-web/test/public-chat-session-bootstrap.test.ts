import { describe, expect, it } from "vitest";

import publicChatAppSource from "../src/public-chat/app.tsx?raw";

describe("public chat session bootstrap", () => {
  it("does not list effect events as reactive dependencies", () => {
    expect(publicChatAppSource).not.toContain("}, [refreshSession]);");
    expect(publicChatAppSource).not.toContain("}, [refreshConversations, session]);");
    expect(publicChatAppSource).not.toContain(
      "[conversations, historyError, historyLoading, refreshConversations, refreshSession, session],",
    );
    expect(publicChatAppSource).not.toContain("}, [conversationId, loadConversation]);");
  });
});
