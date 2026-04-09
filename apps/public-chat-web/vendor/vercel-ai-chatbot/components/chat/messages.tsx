"use client";

import { ArrowDownIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useMessages } from "@/hooks/use-messages";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

export function Messages(props: {
  chatId: string;
  isArtifactVisible: boolean;
  isLoading?: boolean;
  isReadonly: boolean;
  messages: ChatMessage[];
  selectedModelId: string;
  status: "error" | "ready" | "streaming" | "submitted";
}) {
  const { containerRef, endRef, isAtBottom, reset, scrollToBottom } = useMessages({
    status: props.status,
  });
  const previousChatId = useRef(props.chatId);

  useEffect(() => {
    if (previousChatId.current !== props.chatId) {
      previousChatId.current = props.chatId;
      reset();
    }
  }, [props.chatId, reset]);

  return (
    <div className="relative flex-1 bg-background">
      {props.messages.length === 0 && !props.isLoading ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Greeting />
        </div>
      ) : null}

      <div
        className={cn(
          "absolute inset-0 touch-pan-y overflow-y-auto",
          props.messages.length > 0 ? "bg-background" : "bg-transparent",
        )}
        ref={containerRef}
        style={props.isArtifactVisible ? { scrollbarWidth: "none" } : undefined}
      >
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-5 px-2 py-6 md:gap-7 md:px-4">
          {props.messages.map((message, index) => (
            <PreviewMessage
              isLoading={props.status === "submitted" && props.messages.length - 1 === index}
              key={message.id}
              message={message}
            />
          ))}

          {props.status === "submitted" && props.messages.at(-1)?.role !== "assistant" ? (
            <ThinkingMessage />
          ) : null}

          <div className="min-h-[24px] min-w-[24px] shrink-0" ref={endRef} />
        </div>
      </div>

      <button
        aria-label="Scroll to bottom"
        className={`absolute bottom-4 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 text-[10px] shadow-[var(--shadow-float)] backdrop-blur-lg transition-all duration-200 ${
          isAtBottom
            ? "pointer-events-none scale-90 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={() => scrollToBottom("smooth")}
        type="button"
      >
        <ArrowDownIcon className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}
