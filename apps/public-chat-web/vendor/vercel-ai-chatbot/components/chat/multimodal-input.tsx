"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ArrowUpIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import { deleteAllConversations, deleteConversation } from "@/app/(chat)/actions";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { Button } from "../ui/button";
import { StopIcon } from "./icons";
import {
  type SlashCommand,
  SlashCommandMenu,
  slashCommands,
} from "./slash-commands";
import { SuggestedActions } from "./suggested-actions";
import type { VisibilityType } from "./visibility-selector";

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  messages,
  setMessages,
  sendMessage,
  prepareConversationRoute,
  className,
  selectedVisibilityType,
  editingMessage,
  onCancelEdit,
  isLoading,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  prepareConversationRoute?: (conversationId: string) => void;
  className?: string;
  selectedVisibilityType: VisibilityType;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  isLoading?: boolean;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage("input", "");
  const hasHydratedInput = useRef(false);

  useEffect(() => {
    if (hasHydratedInput.current) {
      return;
    }

    const finalValue = localStorageInput || "";
    setInput(finalValue);
    hasHydratedInput.current = true;
  }, [localStorageInput, setInput]);

  useEffect(() => {
    if (localStorageInput !== input) {
      setLocalStorageInput(input);
    }
  }, [input, localStorageInput, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = event.target.value;
    setInput(val);

    if (val.startsWith("/") && !val.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(val.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    setSlashOpen(false);
    setInput("");
    switch (cmd.action) {
      case "new":
        void router.push("/chat");
        break;
      case "delete":
        toast("删除这条对话？", {
          action: {
            label: "删除",
            onClick: async () => {
              try {
                await deleteConversation(chatId);
                mutate(unstable_serialize(getChatHistoryPaginationKey));
                await router.push("/chat");
                toast.success("已删除对话");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "删除对话失败，请稍后重试。");
              }
            },
          },
        });
        break;
      case "purge":
        toast("清空全部对话？", {
          action: {
            label: "全部删除",
            onClick: async () => {
              try {
                await deleteAllConversations();
                mutate(unstable_serialize(getChatHistoryPaginationKey), [], {
                  revalidate: false,
                });
                await router.push("/chat");
                toast.success("已清空全部对话");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "清空历史失败，请稍后重试。");
              }
            },
          },
        });
        break;
      default:
        break;
    }
  };

  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const submitForm = useCallback(async () => {
    prepareConversationRoute?.(chatId);
    await router.push(`/chat/${chatId}`);

    void sendMessage({
      role: "user",
      parts: [
        {
          type: "text",
          text: input,
        },
      ],
    });

    setLocalStorageInput("");
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    chatId,
    input,
    prepareConversationRoute,
    router,
    sendMessage,
    setInput,
    setLocalStorageInput,
    width,
  ]);

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {editingMessage && onCancelEdit && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>正在编辑消息</span>
          <button
            className="rounded px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              onCancelEdit();
            }}
            type="button"
          >
            取消
          </button>
        </div>
      )}

      {!editingMessage &&
        !isLoading &&
        messages.length === 0 && (
          <SuggestedActions
            chatId={chatId}
            prepareConversationRoute={prepareConversationRoute}
            selectedVisibilityType={selectedVisibilityType}
            sendMessage={sendMessage}
          />
        )}

      <div className="relative">
        {slashOpen && (
          <SlashCommandMenu
            onClose={() => setSlashOpen(false)}
            onSelect={handleSlashSelect}
            query={slashQuery}
            selectedIndex={slashIndex}
          />
        )}
      </div>

      <PromptInput
        className="[&>div]:rounded-2xl [&>div]:border [&>div]:border-border/30 [&>div]:bg-card/70 [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-300 [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]"
        onSubmit={() => {
          if (input.startsWith("/")) {
            const query = input.slice(1).trim();
            const cmd = slashCommands.find((c) => c.name === query);
            if (cmd) {
              handleSlashSelect(cmd);
            }
            return;
          }
          if (!input.trim()) {
            return;
          }
          if (status === "ready" || status === "error") {
            void submitForm();
          } else {
            toast.error("请等待当前回答完成后再继续");
          }
        }}
      >
        <PromptInputTextarea
          className="min-h-24 text-[13px] leading-relaxed px-4 pt-3.5 pb-1.5 placeholder:text-muted-foreground/35"
          data-testid="multimodal-input"
          onChange={handleInput}
          onKeyDown={(e) => {
            if (slashOpen) {
              const filtered = slashCommands.filter((cmd) =>
                cmd.name.startsWith(slashQuery.toLowerCase()),
              );
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (filtered[slashIndex]) {
                  handleSlashSelect(filtered[slashIndex]);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashOpen(false);
                return;
              }
            }
            if (e.key === "Escape" && editingMessage && onCancelEdit) {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          placeholder={
            editingMessage
              ? "编辑这条消息..."
              : "请输入你想了解的校园信息，例如培养方案、课程要求、学生政策或校园服务"
          }
          ref={textareaRef}
          value={input}
        />
        <PromptInputFooter className="px-3 pb-3">
          <PromptInputTools />

          {status === "submitted" || status === "streaming" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className={cn(
                "h-7 w-7 rounded-xl transition-all duration-200",
                input.trim()
                  ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                  : "bg-muted text-muted-foreground/25 cursor-not-allowed",
              )}
              data-testid="send-button"
              disabled={!input.trim()}
              status={status}
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

export const MultimodalInput = memo(PureMultimodalInput, (prevProps, nextProps) => {
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
    return false;
  }
  if (prevProps.editingMessage !== nextProps.editingMessage) {
    return false;
  }
  if (prevProps.isLoading !== nextProps.isLoading) {
    return false;
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    return false;
  }

  return true;
});

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: UseChatHelpers<ChatMessage>["stop"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="h-7 w-7 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        void stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
