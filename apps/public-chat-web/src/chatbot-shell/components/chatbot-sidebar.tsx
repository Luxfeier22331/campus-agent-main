import { ArrowRight, Plus, Sparkles } from "lucide-react";

import type { ShellConversationListItem, ShellSessionPrincipal } from "../adapters";
import { Button } from "./ui/button";

interface ChatbotSidebarProps {
  activeConversationId: string | null;
  historyError: string | null;
  historyLoading: boolean;
  items: ShellConversationListItem[];
  onNewChat: () => void;
  onRefresh: () => void;
  onSelectConversation: (conversationId: string) => void;
  onSignOut: () => void;
  principal: ShellSessionPrincipal;
}

export function ChatbotSidebar({
  activeConversationId,
  historyError,
  historyLoading,
  items,
  onNewChat,
  onRefresh,
  onSelectConversation,
  onSignOut,
  principal,
}: ChatbotSidebarProps) {
  return (
    <aside className="flex h-dvh flex-col gap-6 border-b border-chat-border bg-chat-rail/80 px-4 py-5 backdrop-blur lg:border-b-0 lg:border-r">
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-chat-accent">Public chat</p>
          <div className="space-y-1">
            <h1 className="font-serif text-3xl leading-none text-chat-ink">Campus Agent</h1>
            <p className="max-w-xs text-sm text-chat-muted">
              Ask handbook and curriculum questions through the chat-first public browser surface.
            </p>
          </div>
        </div>

        <Button className="w-full justify-between" onClick={onNewChat} type="button" variant="primary">
          New chat
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-chat-muted">
            Recent threads
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex size-9 items-center justify-center rounded-full border border-transparent text-chat-muted transition-colors hover:border-chat-border hover:bg-chat-panel hover:text-chat-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chat-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chat-bg"
              onClick={onRefresh}
              type="button"
            >
              <Sparkles className="size-4" />
              <span className="sr-only">Refresh conversation history</span>
            </button>
          </div>
        </div>

        {historyLoading ? <p className="text-sm text-chat-muted">Refreshing conversation history…</p> : null}
        {historyError ? <p className="text-sm text-red-700">{historyError}</p> : null}
        {items.length === 0 && !historyLoading ? (
          <p className="text-sm text-chat-muted">Saved conversations will appear here.</p>
        ) : null}

        <nav aria-label="Conversation history" className="space-y-2">
          {items.map((item) => {
            const isActive = item.id === activeConversationId;

            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className={[
                  "flex w-full flex-col gap-2 rounded-3xl border px-4 py-3 text-left transition-colors",
                  isActive
                    ? "border-chat-accent/45 bg-chat-panel text-chat-ink shadow-sm"
                    : "border-transparent bg-chat-rail text-chat-muted hover:border-chat-border hover:bg-chat-panel/80",
                ].join(" ")}
                key={item.id}
                onClick={() => onSelectConversation(item.id)}
                type="button"
              >
                <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
                <span className="text-xs uppercase tracking-[0.18em] text-chat-muted/80">
                  Updated {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(item.updatedAt))}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="rounded-[1.75rem] border border-chat-border bg-chat-panel px-4 py-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-chat-accent">
          Signed-in session
        </p>
        <p className="mt-2 text-sm text-chat-muted">
          Your saved threads follow the same signed-in app session across this public surface.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-chat-ink">{principal.displayName}</p>
            <p className="text-sm text-chat-muted">{principal.email || "Signed-in app user"}</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1 justify-between" onClick={onSignOut} type="button" variant="secondary">
              Sign out
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
