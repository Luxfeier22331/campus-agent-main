import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ShellMessage } from "../src/chatbot-shell/adapters";
import { ChatbotThread } from "../src/chatbot-shell/components/chatbot-thread";

function renderThread(messages: ShellMessage[]) {
  return renderToStaticMarkup(createElement(ChatbotThread, { messages }));
}

describe("ChatbotThread", () => {
  it("renders explicit assistant result-state affordances for answer, clarification, no-answer, and error", () => {
    const html = renderThread([
      {
        createdAt: "2026-04-06T12:00:00.000Z",
        id: "msg_answer",
        kind: "answer",
        requestId: "req_answer",
        retryable: false,
        role: "assistant",
        text: "这是 grounded answer。",
      },
      {
        createdAt: "2026-04-06T12:00:01.000Z",
        id: "msg_clarification",
        kind: "clarification",
        requestId: "req_clarification",
        retryable: false,
        role: "assistant",
        text: "你是想问法学民族班还是别的民族实验班？",
      },
      {
        createdAt: "2026-04-06T12:00:02.000Z",
        id: "msg_no_answer",
        kind: "no_answer",
        requestId: "req_no_answer",
        retryable: false,
        role: "assistant",
        text: "当前证据不足，不能直接回答。",
      },
      {
        createdAt: "2026-04-06T12:00:03.000Z",
        id: "msg_error",
        kind: "error",
        requestId: "req_error",
        retryable: true,
        role: "assistant",
        text: "请求执行失败。",
      },
    ]);

    expect(html).toContain("Answer");
    expect(html).toContain("Clarification needed");
    expect(html).toContain("No grounded answer");
    expect(html).toContain("Request error");
    expect(html).toContain("Needs more detail before answering.");
    expect(html).toContain("The current evidence does not support a grounded answer yet.");
    expect(html).toContain("You can retry this request.");
  });
});
