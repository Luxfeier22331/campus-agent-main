import { describe, expect, it } from "vitest";

import chatHeaderSource from "../vendor/vercel-ai-chatbot/components/chat/chat-header.tsx?raw";
import greetingSource from "../vendor/vercel-ai-chatbot/components/chat/greeting.tsx?raw";
import multimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";

describe("vendor chat chrome", () => {
  it("keeps campus greeting copy in the vendor runtime tree", () => {
    expect(greetingSource).toContain("今天想确认什么校园信息？");
    expect(greetingSource).toContain("培养方案、课程要求、学生政策或校园办事问题");
    expect(greetingSource).not.toContain("What can I help with?");
  });

  it("keeps the active header chrome in the vendor shell while leaving sharing off the launch path", () => {
    expect(chatHeaderSource).toContain("Toggle sidebar");
    expect(chatHeaderSource).toContain("VercelIcon");
    expect(chatHeaderSource).toContain("AppLink");
    expect(chatHeaderSource).toContain("Deploy with Vercel");
    expect(chatHeaderSource).not.toContain("VisibilitySelector");
    expect(chatHeaderSource).not.toContain("Same-site Worker shell");
    expect(chatHeaderSource).not.toContain("新对话");
  });

  it("keeps the active vendor composer with campus suggestions and no seam copy", () => {
    expect(multimodalInputSource).toContain('data-testid="multimodal-input"');
    expect(multimodalInputSource).toContain("Ask about curriculum plans, required courses, policies, or campus services...");
    expect(multimodalInputSource).toContain("<SuggestedActions");
    expect(multimodalInputSource).not.toContain("Keep requests specific");
  });
});
