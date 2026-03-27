import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";

import type { ChatMessage } from "../../lib/chat-types";
import { getRetryPromptForMessage } from "../../lib/chat-ui";
import { useScrollToBottom } from "../../hooks/use-scroll-to-bottom";
import { ArrowDownIcon } from "./chat-icons";
import { PreviewMessage, ThinkingMessage } from "./chat-message";

const EASE_STANDARD = [0.22, 1, 0.36, 1] as const;

export function ChatMessageList(props: Readonly<{
  conversationKey: string;
  messages: ChatMessage[];
  onRetryPrompt?: (prompt: string) => void | Promise<unknown>;
  submitting?: boolean;
}>) {
  const { containerRef, endRef, isAtBottom, reset, scrollToBottom } = useScrollToBottom();
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    reset();
    scrollToBottom("auto");
  }, [props.conversationKey, reset, scrollToBottom]);

  return (
    <div className="chatbot-messages-shell">
      <div className="chatbot-messages-scroll" ref={containerRef}>
        <div className="chatbot-messages-column">
          {props.messages.map((message, index) => {
            const retryPrompt = props.onRetryPrompt
              ? getRetryPromptForMessage(props.messages, message.id)
              : null;

            return (
              <motion.article
                animate={{ opacity: 1, y: 0 }}
                className="chatbot-message-frame"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                key={message.id}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : {
                        delay: Math.min(index * 0.03, 0.12),
                        duration: 0.2,
                        ease: EASE_STANDARD,
                      }
                }
              >
                <PreviewMessage
                  isLoading={props.submitting}
                  message={message}
                  onRetry={
                    retryPrompt
                      ? () => props.onRetryPrompt?.(retryPrompt)
                      : null
                  }
                  retryLabel={props.submitting ? "Retrying..." : "Retry"}
                />
              </motion.article>
            );
          })}

          {props.submitting ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="chatbot-thinking-frame"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              role="status"
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: EASE_STANDARD }}
            >
              <ThinkingMessage />
            </motion.div>
          ) : null}

          <div ref={endRef} />
        </div>
      </div>

      {!isAtBottom && props.messages.length > 0 ? (
        <button
          aria-label="Scroll to bottom"
          className="chatbot-scroll-bottom"
          onClick={() => scrollToBottom("smooth")}
          type="button"
        >
          <ArrowDownIcon />
        </button>
      ) : null}
    </div>
  );
}
