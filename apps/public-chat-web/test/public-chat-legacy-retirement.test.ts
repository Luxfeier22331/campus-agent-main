import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import suggestedActionsSource from "../vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx?raw";

describe("public chat legacy retirement", () => {
  it("does not keep legacy shell directories or duplicate auth clients in the app source tree", () => {
    expect(existsSync(new URL("../src/chatbot-shell", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/chatbot-donor", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/public-chat", import.meta.url))).toBe(false);
  });

  it("does not fake a conversation route before the canonical conversation id exists", () => {
    expect(suggestedActionsSource).not.toContain("window.history.pushState");
    expect(suggestedActionsSource).not.toContain("/chat/${chatId}");
  });
});
