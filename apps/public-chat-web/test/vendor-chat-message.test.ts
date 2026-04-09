import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../vendor/vercel-ai-chatbot/lib/types";
import { PreviewMessage } from "../vendor/vercel-ai-chatbot/components/chat/message";

function createMessage(input: {
  id: string;
  kind?: ChatMessage["kind"];
  role: ChatMessage["role"];
  text: string;
}): ChatMessage {
  return {
    id: input.id,
    kind: input.kind,
    metadata: {
      createdAt: "2026-04-06T12:00:00.000Z",
    },
    parts: [{ text: input.text, type: "text" }],
    role: input.role,
  } as ChatMessage;
}

describe("vendor chat messages", () => {
  it("preserves assistant outcome semantics in the active vendor message chrome", () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(PreviewMessage, {
          isLoading: false,
          message: createMessage({
            id: "msg_user",
            kind: "user",
            role: "user",
            text: "法学民族实验班培养方案里第四学期有什么课？",
          }),
        }),
        createElement(PreviewMessage, {
          isLoading: false,
          message: createMessage({
            id: "msg_answer",
            kind: "answer",
            role: "assistant",
            text: "这是 grounded answer。",
          }),
        }),
        createElement(PreviewMessage, {
          isLoading: false,
          message: createMessage({
            id: "msg_clarification",
            kind: "clarification",
            role: "assistant",
            text: "你是想问法学民族班还是别的民族实验班？",
          }),
        }),
        createElement(PreviewMessage, {
          isLoading: false,
          message: createMessage({
            id: "msg_no_answer",
            kind: "no_answer",
            role: "assistant",
            text: "当前证据不足，不能直接回答。",
          }),
        }),
        createElement(PreviewMessage, {
          isLoading: false,
          message: createMessage({
            id: "msg_error",
            kind: "error",
            role: "assistant",
            text: "请求执行失败。",
          }),
        }),
      ),
    );

    expect(html).toContain('data-testid="message-user"');
    expect(html).toContain('data-testid="message-assistant"');
    expect(html).toContain("clarification");
    expect(html).toContain("no answer");
    expect(html).toContain("error");
    expect(html).not.toContain("Clarification needed");
    expect(html).not.toContain("Needs more detail before answering.");
    expect(html).not.toContain("The current evidence does not support a grounded answer yet.");
    expect(html).not.toContain("You can retry this request.");
  });
});
