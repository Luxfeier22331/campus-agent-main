import { memo } from "react";

import type { ChatMessage } from "../../lib/chat-types";
import { formatChatMessageRole } from "../../lib/chat-ui";

export function ThinkingMessage() {
  return (
    <div className="chatbot-thinking-row" role="status">
      <span className="chatbot-thinking-dot" />
      <span className="chatbot-thinking-dot" />
      <span className="chatbot-thinking-dot" />
    </div>
  );
}

function PurePreviewMessage(props: Readonly<{
  isLoading?: boolean;
  message: ChatMessage;
  onRetry?: (() => void | Promise<unknown>) | null;
  retryLabel?: string;
}>) {
  const isUser = props.message.role === "user";
  const isError = props.message.kind === "error";
  const isClarification = props.message.kind === "clarification";

  return (
    <article
      className={[
        "chatbot-message-row",
        isUser ? "is-user" : "is-assistant",
        isError ? "is-error" : "",
        isClarification ? "is-clarification" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="chatbot-message-inner">
        <div className="chatbot-message-meta">{formatChatMessageRole(props.message)}</div>
        <div className="chatbot-message-bubble">
          <p>{props.message.text}</p>
        </div>
        {props.message.requestId ? (
          <div className="chatbot-message-request">request_id: {props.message.requestId}</div>
        ) : null}
        {props.onRetry ? (
          <div className="chatbot-message-actions">
            <button
              className="chatbot-message-retry"
              disabled={props.isLoading}
              onClick={() => {
                void props.onRetry?.();
              }}
              type="button"
            >
              {props.retryLabel ?? "Retry"}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const PreviewMessage = memo(PurePreviewMessage);
