"use client";

import { BotIcon, UserIcon } from "@/components/chat/icons";
import { cn, sanitizeText } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

export function PreviewMessage(props: { isLoading: boolean; message: ChatMessage }) {
  const text = props.message.parts
    .filter((part): part is Extract<ChatMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => sanitizeText(part.text))
    .join("\n\n");
  const isUser = props.message.role === "user";
  const isAssistant = props.message.role === "assistant";

  return (
    <article
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
      data-testid={`message-${props.message.role}`}
    >
      {!isUser ? (
        <div className="mt-1 hidden size-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-card text-foreground shadow-[var(--shadow-card)] md:flex">
          <BotIcon />
        </div>
      ) : null}

      <div className={cn("flex max-w-[min(100%,56rem)] flex-col gap-2", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "overflow-hidden break-words rounded-2xl px-4 py-3 text-[13px] leading-[1.7] shadow-[var(--shadow-card)]",
            isUser
              ? "max-w-[min(82%,56ch)] rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted text-foreground"
              : "w-full border border-border/40 bg-card/90 text-foreground",
          )}
        >
          {text}
        </div>

        {isAssistant && props.message.kind && props.message.kind !== "answer" ? (
          <p className="px-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
            {props.message.kind.replace("_", " ")}
          </p>
        ) : null}
      </div>

      {isUser ? (
        <div className="mt-1 hidden size-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-card text-foreground shadow-[var(--shadow-card)] md:flex">
          <UserIcon />
        </div>
      ) : null}
    </article>
  );
}

export function ThinkingMessage() {
  return (
    <article className="flex w-full justify-start gap-3">
      <div className="mt-1 hidden size-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-card text-foreground shadow-[var(--shadow-card)] md:flex">
        <BotIcon />
      </div>
      <div className="rounded-2xl border border-border/40 bg-card/90 px-4 py-3 text-[13px] text-muted-foreground shadow-[var(--shadow-card)]">
        正在生成回答…
      </div>
    </article>
  );
}
