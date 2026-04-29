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
import { useWindowSize } from "usehooks-ts";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { StopIcon } from "./icons";
import {
  type SlashCommand,
  SlashCommandMenu,
  slashCommands,
} from "./slash-commands";
import { SuggestedActions } from "./suggested-actions";
import type { VisibilityType } from "./visibility-selector";

const CHAT_INPUT_DRAFT_STORAGE_KEY = "campus-agent.public-chat.input.v1";
const CHAT_INPUT_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const CHAT_INPUT_DRAFT_MAX_LENGTH = 4000;

type PendingDestructiveCommand = "delete" | "purge";

type StoredPromptDraft = {
  input: string;
  updatedAt: number;
};

function getDraftStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readPromptDraft(): string {
  const storage = getDraftStorage();
  if (!storage) {
    return "";
  }

  try {
    const rawValue = storage.getItem(CHAT_INPUT_DRAFT_STORAGE_KEY);
    if (!rawValue) {
      return "";
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredPromptDraft>;
    if (typeof parsed.input !== "string" || typeof parsed.updatedAt !== "number") {
      storage.removeItem(CHAT_INPUT_DRAFT_STORAGE_KEY);
      return "";
    }

    if (Date.now() - parsed.updatedAt > CHAT_INPUT_DRAFT_TTL_MS) {
      storage.removeItem(CHAT_INPUT_DRAFT_STORAGE_KEY);
      return "";
    }

    return parsed.input.slice(0, CHAT_INPUT_DRAFT_MAX_LENGTH);
  } catch {
    storage.removeItem(CHAT_INPUT_DRAFT_STORAGE_KEY);
    return "";
  }
}

function writePromptDraft(input: string) {
  const storage = getDraftStorage();
  if (!storage) {
    return;
  }

  try {
    if (!input) {
      storage.removeItem(CHAT_INPUT_DRAFT_STORAGE_KEY);
      return;
    }

    const draft: StoredPromptDraft = {
      input: input.slice(0, CHAT_INPUT_DRAFT_MAX_LENGTH),
      updatedAt: Date.now(),
    };
    storage.setItem(CHAT_INPUT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Best-effort draft persistence must never block chat input.
  }
}

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
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [pendingDestructiveCommand, setPendingDestructiveCommand] =
    useState<PendingDestructiveCommand | null>(null);

  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  useEffect(() => {
    if (isDraftHydrated) {
      return;
    }

    const draftInput = readPromptDraft();
    if (draftInput) {
      setInput((currentInput) => currentInput || draftInput);
    }
    setIsDraftHydrated(true);
  }, [isDraftHydrated, setInput]);

  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    writePromptDraft(input);
  }, [input, isDraftHydrated]);

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
        writePromptDraft("");
        void router.push("/chat");
        break;
      case "delete":
        setPendingDestructiveCommand("delete");
        break;
      case "purge":
        setPendingDestructiveCommand("purge");
        break;
      default:
        break;
    }
  };

  const confirmDestructiveCommand = useCallback(async () => {
    const command = pendingDestructiveCommand;
    if (!command) {
      return;
    }

    setPendingDestructiveCommand(null);

    try {
      if (command === "delete") {
        await deleteConversation(chatId);
        mutate(unstable_serialize(getChatHistoryPaginationKey));
        void router.push("/chat");
        toast.success("已删除对话");
        return;
      }

      await deleteAllConversations();
      mutate(unstable_serialize(getChatHistoryPaginationKey), [], {
        revalidate: false,
      });
      void router.push("/chat");
      toast.success("已清空全部对话");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : command === "delete"
            ? "删除对话失败，请稍后重试。"
            : "清空历史失败，请稍后重试。",
      );
    }
  }, [chatId, mutate, pendingDestructiveCommand, router]);

  const submitForm = useCallback(async () => {
    prepareConversationRoute?.(chatId);
    await router.push(`/chat/${chatId}`);

    await sendMessage({
      role: "user",
      parts: [
        {
          type: "text",
          text: input,
        },
      ],
    });

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    chatId,
    input,
    prepareConversationRoute,
    router,
    sendMessage,
    width,
  ]);

  const destructiveDialogTitle =
    pendingDestructiveCommand === "purge" ? "清空全部对话？" : "删除这条对话？";
  const destructiveDialogDescription =
    pendingDestructiveCommand === "purge"
      ? "此操作会删除当前账号下的全部公开聊天记录，删除后不能恢复。"
      : "此操作会删除当前对话及其消息记录，删除后不能恢复。";

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
        attachmentsEnabled={false}
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
              aria-label="发送消息"
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

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingDestructiveCommand(null);
          }
        }}
        open={pendingDestructiveCommand !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{destructiveDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{destructiveDialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmDestructiveCommand();
              }}
              variant="destructive"
            >
              {pendingDestructiveCommand === "purge" ? "全部删除" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      aria-label="停止生成"
      className="h-7 w-7 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        void stop();
        setMessages((messages) => messages);
      }}
      type="button"
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
