"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { memo } from "react";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import { SuggestedActions } from "./suggested-actions";
import type { VisibilityType } from "./visibility-selector";

function PureMultimodalInput(props: {
  className?: string;
  input: string;
  isLoading?: boolean;
  messages: ChatMessage[];
  selectedVisibilityType: VisibilityType;
  sendMessage: (message: { parts: Array<{ text: string; type: "text" }>; role: "user" }) => Promise<void>;
  setInput: (value: string) => void;
  status: "error" | "ready" | "streaming" | "submitted";
  stop: () => void;
}) {
  return (
    <div className={cn("relative flex w-full flex-col gap-4", props.className)}>
      {!props.isLoading && props.messages.length === 0 ? (
        <SuggestedActions
          selectedVisibilityType={props.selectedVisibilityType}
          sendMessage={props.sendMessage}
        />
      ) : null}

      <PromptInput
        className="[&>div]:rounded-2xl [&>div]:border [&>div]:border-border/30 [&>div]:bg-card/70 [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-300 [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]"
        onSubmit={() => {
          if (!props.input.trim()) {
            return;
          }

          if (props.status === "submitted" || props.status === "streaming") {
            return;
          }

          void props.sendMessage({
            parts: [{ text: props.input.trim(), type: "text" }],
            role: "user",
          });
        }}
      >
        <PromptInputTextarea
          className="min-h-24 px-4 pt-3.5 pb-1.5 text-[13px] leading-relaxed placeholder:text-muted-foreground/35"
          data-testid="multimodal-input"
          onChange={(event) => props.setInput(event.target.value)}
          placeholder="Ask about curriculum plans, required courses, policies, or campus services..."
          value={props.input}
        />
        <PromptInputFooter className="px-3 pb-3">
          {props.status === "submitted" ? (
            <Button
              aria-label="Stop response"
              className="h-7 w-7 rounded-xl"
              onClick={props.stop}
              size="icon-sm"
              type="button"
              variant="secondary"
            >
              <SquareIcon className="size-3.5" />
            </Button>
          ) : (
            <PromptInputSubmit
              className={cn(
                "h-7 w-7 rounded-xl transition-all duration-200",
                props.input.trim()
                  ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                  : "cursor-not-allowed bg-muted text-muted-foreground/25",
              )}
              data-testid="send-button"
              disabled={!props.input.trim()}
              status={props.status}
              variant="secondary"
            >
              <ArrowUpIcon className="size-4" />
            </PromptInputSubmit>
          )}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(PureMultimodalInput, (previous, next) => {
  return (
    previous.input === next.input &&
    previous.isLoading === next.isLoading &&
    previous.messages.length === next.messages.length &&
    previous.selectedVisibilityType === next.selectedVisibilityType &&
    previous.status === next.status
  );
});
