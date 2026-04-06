import "./styles.css";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import { UnauthorizedError } from "../public-chat/api";
import { signOutChatSession } from "../public-chat/auth";
import { usePublicChatAppContext } from "../public-chat/context";
import {
  createShellDraftConversation,
  getShellConversationDetail,
  mapConversationSummary,
  mapSessionPrincipal,
  submitShellChatRequest,
  type ShellConversationDetail,
} from "./adapters";
import { ChatbotComposer } from "./components/chatbot-composer";
import { ChatbotEmptyState } from "./components/chatbot-empty-state";
import { ChatbotSidebar } from "./components/chatbot-sidebar";
import { ChatbotThread } from "./components/chatbot-thread";

function ShellStatusCard(props: { eyebrow?: string; message: string; title: string }) {
  return (
    <section className="rounded-[2rem] border border-chat-border bg-white/95 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-chat-accent">
        {props.eyebrow ?? "Public chat"}
      </p>
      <div className="mt-3 space-y-2">
        <h3 className="font-serif text-3xl leading-none text-chat-ink">{props.title}</h3>
        <p className="text-sm leading-6 text-chat-muted">{props.message}</p>
      </div>
    </section>
  );
}

export function ChatbotShellPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const {
    conversations,
    historyError,
    historyLoading,
    refreshConversations,
    session,
    setSessionUnauthenticated,
    upsertConversationSummary,
  } = usePublicChatAppContext();
  const [conversation, setConversation] = useState<ShellConversationDetail | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);

  const principal =
    session.kind === "authenticated" ? mapSessionPrincipal(session.principal) : null;
  const sidebarItems = useMemo(
    () => conversations.map(mapConversationSummary),
    [conversations],
  );

  const handleUnauthorized = useEffectEvent(async () => {
    setSessionUnauthenticated();
    await navigate("/login", { replace: true });
  });

  const loadConversation = useEffectEvent(async () => {
    if (!conversationId) {
      startTransition(() => {
        setConversation(null);
        setLoadingConversation(false);
        setThreadError(null);
      });
      return;
    }

    startTransition(() => {
      setLoadingConversation(true);
      setThreadError(null);
    });

    try {
      const detail = await getShellConversationDetail(conversationId);
      startTransition(() => {
        setConversation(detail);
        setLoadingConversation(false);
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await handleUnauthorized();
        return;
      }

      startTransition(() => {
        setConversation(null);
        setLoadingConversation(false);
        setThreadError(
          error instanceof Error ? error.message : "Unable to load this conversation.",
        );
      });
    }
  });

  useEffect(() => {
    void loadConversation();
  }, [conversationId]);

  const handleCreateDraft = async () => {
    setCreatingDraft(true);
    setThreadError(null);

    try {
      const draft = await createShellDraftConversation();
      upsertConversationSummary(draft);
      await navigate(`/chat/${draft.id}`);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await handleUnauthorized();
        return;
      }

      setThreadError(
        error instanceof Error ? error.message : "Unable to create a draft thread.",
      );
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleSendPrompt = async (prompt: string) => {
    setSubmitting(true);
    setThreadError(null);

    try {
      const outcome = await submitShellChatRequest(
        conversationId
          ? {
              conversationId,
              prompt,
            }
          : {
              prompt,
            },
      );

      startTransition(() => {
        setConversation(outcome.conversation);
      });
      upsertConversationSummary(outcome.conversation);

      if (!conversationId || conversationId !== outcome.conversation.id) {
        await navigate(`/chat/${outcome.conversation.id}`);
      }

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await handleUnauthorized();
        return false;
      }

      setThreadError(
        error instanceof Error ? error.message : "Unable to send this message.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutChatSession();
    } finally {
      setSessionUnauthenticated();
      await navigate("/login", { replace: true });
    }
  };

  const headerTitle = conversation?.title ?? "New chat";
  const headerDescription = conversation
    ? "Replies stay attached to the canonical conversation returned by app-api."
    : "Start directly with a question, or create an empty draft if you want a saved thread first.";

  if (!principal) {
    return (
      <ShellStatusCard
        message="Checking your session..."
        title="Loading chat"
      />
    );
  }

  return (
    <div className="chatbot-shell min-h-dvh bg-chat-bg text-chat-ink">
      <div className="grid min-h-dvh lg:grid-cols-[20rem_minmax(0,1fr)_18rem]">
        <ChatbotSidebar
          activeConversationId={conversationId ?? null}
          historyError={historyError}
          historyLoading={historyLoading}
          items={sidebarItems}
          onNewChat={() => void navigate("/chat")}
          onRefresh={() => void refreshConversations()}
          onSelectConversation={(nextConversationId) => void navigate(`/chat/${nextConversationId}`)}
          onSignOut={() => void handleSignOut()}
          principal={principal}
        />

        <main className="flex min-h-dvh flex-col">
          <header className="border-b border-chat-border bg-chat-bg/90 px-6 py-5 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-chat-accent">
                  Same-site Worker shell
                </p>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-2">
                    <h2 className="font-serif text-4xl leading-none text-balance">
                      {headerTitle}
                    </h2>
                    <p className="max-w-3xl text-pretty text-sm leading-6 text-chat-muted">
                      {headerDescription}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-6">
            {loadingConversation ? (
              <ShellStatusCard
                message="Loading this conversation through the repo-owned conversation adapter."
                title="Preparing conversation"
              />
            ) : conversation ? (
              <ChatbotThread messages={conversation.messages} />
            ) : (
              <ChatbotEmptyState
                busy={creatingDraft}
                error={threadError}
                onCreateDraft={() => void handleCreateDraft()}
              />
            )}

            <ChatbotComposer
              defaultValue={conversation ? "" : "法学民族班培养方案里大二下有什么课？"}
              disabled={creatingDraft}
              draftKey={conversation?.id ?? "new"}
              onSubmit={handleSendPrompt}
              placeholder={
                conversation
                  ? "Reply with another campus question or follow-up..."
                  : "Ask about curriculum plans, handbook rules, or common campus workflows..."
              }
              submitLabel={conversation ? "Send reply" : "Start with real request"}
              submitting={submitting}
            />

            {conversation && threadError ? <p className="text-sm text-red-700">{threadError}</p> : null}
          </div>
        </main>

        <aside className="border-t border-chat-border bg-chat-panel/70 px-5 py-6 lg:border-l lg:border-t-0">
          <div className="space-y-5">
            <section className="rounded-[1.75rem] border border-chat-border bg-white/90 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-chat-accent">
                Current coverage
              </p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-chat-muted">
                <li>Student handbook and curriculum plan are the current default query-serving surfaces.</li>
                <li>Saved conversations stay on the shared app-api conversation truth.</li>
                <li>Ambiguous asks may trigger clarification instead of a guessed answer.</li>
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-chat-border bg-chat-ink px-5 py-5 text-chat-panel shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-chat-accent-soft">
                How this chat behaves
              </p>
              <ol className="mt-4 space-y-3 text-sm leading-6 text-chat-panel/80">
                <li>Ask in natural language; the system may ask a follow-up when the target is ambiguous.</li>
                <li>New threads can start without a pre-created conversation id.</li>
                <li>Your conversation list and thread detail stay attached to this signed-in app session.</li>
              </ol>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
