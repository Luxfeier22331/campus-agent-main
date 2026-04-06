import { AlertCircle, Bot, CircleHelp, UserRound } from "lucide-react";

import type { ShellMessage } from "../adapters";
import { cn } from "../lib/utils";

interface ChatbotThreadProps {
  messages: ShellMessage[];
}

interface AssistantMessagePresentation {
  articleClassName: string;
  badgeClassName: string;
  badgeLabel: string;
  detail: string | null;
  iconClassName: string;
}

function messageIcon(message: ShellMessage) {
  if (message.role === "user") {
    return UserRound;
  }

  if (message.kind === "clarification") {
    return CircleHelp;
  }

  if (message.kind === "error") {
    return AlertCircle;
  }

  return Bot;
}

function assistantMessagePresentation(message: ShellMessage): AssistantMessagePresentation {
  switch (message.kind) {
    case "clarification":
      return {
        articleClassName: "border-amber-200 bg-amber-50/80",
        badgeClassName: "bg-amber-100 text-amber-900",
        badgeLabel: "Clarification needed",
        detail: "Needs more detail before answering.",
        iconClassName: "border-amber-200 bg-amber-100 text-amber-900",
      };
    case "no_answer":
      return {
        articleClassName: "border-slate-200 bg-slate-50/90",
        badgeClassName: "bg-slate-200 text-slate-700",
        badgeLabel: "No grounded answer",
        detail: "The current evidence does not support a grounded answer yet.",
        iconClassName: "border-slate-200 bg-slate-100 text-slate-700",
      };
    case "error":
      return {
        articleClassName: "border-red-200 bg-red-50/90",
        badgeClassName: "bg-red-100 text-red-800",
        badgeLabel: "Request error",
        detail: message.retryable
          ? "You can retry this request."
          : "The request failed after execution started.",
        iconClassName: "border-red-200 bg-red-100 text-red-800",
      };
    case "answer":
    default:
      return {
        articleClassName: "border-chat-border/90 bg-white/95",
        badgeClassName: "bg-chat-accent-soft text-chat-accent-strong",
        badgeLabel: "Answer",
        detail: null,
        iconClassName: "border-chat-accent/30 bg-chat-accent-soft text-chat-accent-strong",
      };
  }
}

export function ChatbotThread({ messages }: ChatbotThreadProps) {
  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const Icon = messageIcon(message);
        const isUser = message.role === "user";
        const presentation = isUser ? null : assistantMessagePresentation(message);

        return (
          <article
            className={cn(
              "rounded-[2rem] border px-5 py-4 shadow-sm",
              isUser
                ? "ml-auto max-w-3xl border-chat-border bg-chat-panel"
                : cn("mr-auto max-w-4xl", presentation?.articleClassName),
            )}
            key={message.id}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border",
                  isUser
                    ? "border-chat-border bg-chat-rail text-chat-ink"
                    : presentation?.iconClassName,
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-chat-ink">
                    {isUser ? "Student prompt" : "Campus Agent"}
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                      isUser
                        ? "bg-chat-rail text-chat-ink"
                        : presentation?.badgeClassName,
                    )}
                  >
                    {isUser ? "Prompt" : presentation?.badgeLabel}
                  </span>
                </div>
                {!isUser && presentation?.detail ? (
                  <p className="text-sm leading-6 text-chat-muted">{presentation.detail}</p>
                ) : null}
                <p className="text-pretty text-[15px] leading-7 text-chat-ink">{message.text}</p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
