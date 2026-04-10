import { describe, expect, it } from "vitest";

import messageSource from "../vendor/vercel-ai-chatbot/components/chat/message.tsx?raw";

describe("vendor chat messages", () => {
  it("preserves assistant outcome semantics in the active vendor message chrome", () => {
    expect(messageSource).toContain('data-testid={`message-${message.role}`}');
    expect(messageSource).toContain("MessageActions");
    expect(messageSource).toContain("MessageReasoning");
    expect(messageSource).toContain("ToolHeader");
    expect(messageSource).toContain("DocumentPreview");
    expect(messageSource).not.toContain("Clarification needed");
    expect(messageSource).not.toContain("Needs more detail before answering.");
    expect(messageSource).not.toContain("The current evidence does not support a grounded answer yet.");
    expect(messageSource).not.toContain("You can retry this request.");
  });
});
