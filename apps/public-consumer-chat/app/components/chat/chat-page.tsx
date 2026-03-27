import { useState } from "react";

import type { Conversation, ChatMessage } from "../../lib/chat-types";
import { ChatComposer } from "./chat-composer";
import { ChatConfirmDialog } from "./chat-confirm-dialog";
import { ChatGreeting } from "./chat-greeting";
import { ChatMessageList } from "./chat-message-list";
import { ChatShell } from "./chat-shell";

export function ChatPage(props: Readonly<{
  activeConversationId?: string | null;
  composerDraftKey: string;
  composerPlaceholder: string;
  conversations: Conversation[];
  error?: string | null;
  headerDescription: string;
  headerTitle: string;
  historyLoading?: boolean;
  messages: ChatMessage[];
  mode: "empty" | "thread";
  onDeleteAll?: (() => void | Promise<void>) | null;
  onDeleteConversation?: ((conversationId: string) => void | Promise<void>) | null;
  onNewChat: () => void | Promise<void>;
  onRetryPrompt?: (prompt: string) => void | Promise<unknown>;
  onSendPrompt: (prompt: string) => Promise<boolean>;
  onSignOut: () => void | Promise<void>;
  submitting?: boolean;
  user: {
    email?: string | null;
    name?: string | null;
  };
}>) {
  const [showDeleteConversationDialog, setShowDeleteConversationDialog] = useState(false);
  const headerDescription = props.mode === "thread" ? props.headerDescription : "";
  const headerTitle = props.mode === "thread" ? props.headerTitle : "New chat";

  return (
    <>
      <ChatShell
        activeConversationId={props.activeConversationId}
        conversations={props.conversations}
        headerActions={
          props.onDeleteConversation && props.activeConversationId ? (
            <button
              className="chatbot-header-danger"
              onClick={() => setShowDeleteConversationDialog(true)}
              type="button"
            >
              Delete chat
            </button>
          ) : null
        }
        headerDescription={headerDescription}
        headerTitle={headerTitle}
        historyLoading={props.historyLoading}
        onDeleteAll={props.onDeleteAll}
        onDeleteConversation={props.onDeleteConversation ?? undefined}
        onNewChat={props.onNewChat}
        onSignOut={props.onSignOut}
        user={props.user}
      >
        <section className="chatbot-conversation-stage chatbot-thread-surface">
          <div className="chatbot-thread-scroll-area">
            {props.mode === "empty" ? (
              <ChatGreeting disabled={props.submitting} error={props.error} />
            ) : (
              <ChatMessageList
                conversationKey={props.activeConversationId ?? "new"}
                messages={props.messages}
                onRetryPrompt={props.onRetryPrompt}
                submitting={props.submitting}
              />
            )}
          </div>

          {props.mode === "thread" && props.error ? (
            <p className="chatbot-inline-error chatbot-thread-error" role="alert">
              {props.error}
            </p>
          ) : null}

          <div className="chatbot-composer-dock">
            <ChatComposer
              actionLabel="Send"
              draftKey={props.composerDraftKey}
              onSubmit={props.onSendPrompt}
              placeholder={props.composerPlaceholder}
              submitting={props.submitting}
            />
          </div>
        </section>
      </ChatShell>

      <ChatConfirmDialog
        actionLabel="Delete chat"
        description="This permanently removes the current conversation for the signed-in user."
        onCancel={() => setShowDeleteConversationDialog(false)}
        onConfirm={() => {
          setShowDeleteConversationDialog(false);
          if (props.activeConversationId) {
            void props.onDeleteConversation?.(props.activeConversationId);
          }
        }}
        open={showDeleteConversationDialog && Boolean(props.onDeleteConversation && props.activeConversationId)}
        title="Delete this chat?"
      >
        <p className="chatbot-dialog-note">You cannot recover this thread after deletion.</p>
      </ChatConfirmDialog>
    </>
  );
}
