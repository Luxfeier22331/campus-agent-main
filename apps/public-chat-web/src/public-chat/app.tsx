import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  startTransition,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  UnauthorizedError,
  createDraftConversation,
  getConversationDetail,
  getSessionPrincipal,
  listConversations,
  submitChatRequest,
} from "./api";
import {
  signOutChatSession,
  submitEmailPasswordAuth,
  type AuthFormState,
  type AuthMode,
} from "./auth";
import type {
  ConversationDetail,
  ConversationSummary,
  SessionPrincipal,
} from "./types";

type SessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string }
  | { kind: "authenticated"; principal: SessionPrincipal };

interface PublicChatAppContextValue {
  conversations: ConversationSummary[];
  historyError: string | null;
  historyLoading: boolean;
  refreshConversations: () => Promise<void>;
  refreshSession: () => Promise<void>;
  session: SessionState;
  setSessionUnauthenticated: () => void;
  upsertConversationSummary: (conversation: ConversationDetail) => void;
}

const PublicChatAppContext = createContext<PublicChatAppContextValue | null>(null);

function usePublicChatAppContext() {
  const context = useContext(PublicChatAppContext);
  if (!context) {
    throw new Error("Public chat app context is not available.");
  }

  return context;
}

function toConversationSummary(conversation: ConversationDetail): ConversationSummary {
  return {
    createdAt: conversation.createdAt,
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

function upsertConversationSummary(
  conversations: ConversationSummary[],
  nextConversation: ConversationDetail,
): ConversationSummary[] {
  const nextSummary = toConversationSummary(nextConversation);

  return [
    nextSummary,
    ...conversations.filter((conversation) => conversation.id !== nextConversation.id),
  ];
}

function formatConversationTimestamp(updatedAt: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(updatedAt));
}

function getConversationPreview(conversation: ConversationSummary): string {
  return conversation.title.trim() || "Untitled conversation";
}

function RequireAuthenticatedChat(props: { children: ReactNode }) {
  const { session } = usePublicChatAppContext();

  if (session.kind === "loading") {
    return <RouteStatusCard message="Checking your session..." title="Loading chat" />;
  }

  if (session.kind === "error") {
    return (
      <RouteStatusCard
        actionLabel="Reload"
        message={session.message}
        onAction={() => window.location.reload()}
        title="Chat unavailable"
      />
    );
  }

  if (session.kind === "unauthenticated") {
    return <Navigate replace to="/login" />;
  }

  if (!session.principal.permissions.chat) {
    return (
      <RouteStatusCard
        message="This signed-in principal does not have public chat access."
        title="Access blocked"
      />
    );
  }

  return <>{props.children}</>;
}

export function PublicChatApp() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const refreshSession = useEffectEvent(async () => {
    startTransition(() => {
      setSession({ kind: "loading" });
    });

    try {
      const principal = await getSessionPrincipal();
      startTransition(() => {
        setSession({
          kind: "authenticated",
          principal,
        });
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        startTransition(() => {
          setSession({ kind: "unauthenticated" });
        });
        return;
      }

      startTransition(() => {
        setSession({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to load your session.",
        });
      });
    }
  });

  const refreshConversations = useEffectEvent(async () => {
    if (session.kind !== "authenticated" || !session.principal.permissions.chat) {
      return;
    }

    startTransition(() => {
      setHistoryLoading(true);
      setHistoryError(null);
    });

    try {
      const items = await listConversations();
      startTransition(() => {
        setConversations(items);
        setHistoryLoading(false);
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        startTransition(() => {
          setSession({ kind: "unauthenticated" });
          setHistoryLoading(false);
        });
        return;
      }

      startTransition(() => {
        setHistoryError(error instanceof Error ? error.message : "Unable to load conversation history.");
        setHistoryLoading(false);
      });
    }
  });

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (session.kind === "authenticated" && session.principal.permissions.chat) {
      void refreshConversations();
      return;
    }

    if (session.kind !== "loading") {
      startTransition(() => {
        setConversations([]);
        setHistoryLoading(false);
        setHistoryError(null);
      });
    }
  }, [refreshConversations, session]);

  const contextValue = useMemo<PublicChatAppContextValue>(
    () => ({
      conversations,
      historyError,
      historyLoading,
      refreshConversations,
      refreshSession,
      session,
      setSessionUnauthenticated() {
        startTransition(() => {
          setSession({ kind: "unauthenticated" });
          setConversations([]);
        });
      },
      upsertConversationSummary(conversation) {
        startTransition(() => {
          setConversations((current) => upsertConversationSummary(current, conversation));
        });
      },
    }),
    [conversations, historyError, historyLoading, refreshConversations, refreshSession, session],
  );

  return (
    <PublicChatAppContext.Provider value={contextValue}>
      <BrowserRouter>
        <Routes>
          <Route element={<Navigate replace to="/chat" />} path="/" />
          <Route element={<LoginPage />} path="/login" />
          <Route
            element={
              <RequireAuthenticatedChat>
                <ChatHomePage />
              </RequireAuthenticatedChat>
            }
            path="/chat"
          />
          <Route
            element={
              <RequireAuthenticatedChat>
                <ChatThreadPage />
              </RequireAuthenticatedChat>
            }
            path="/chat/:conversationId"
          />
          <Route element={<Navigate replace to="/chat" />} path="*" />
        </Routes>
      </BrowserRouter>
    </PublicChatAppContext.Provider>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const { refreshSession, session } = usePublicChatAppContext();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [form, setForm] = useState<AuthFormState>({
    email: "",
    name: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (session.kind === "authenticated" && session.principal.permissions.chat) {
      void navigate("/chat", { replace: true });
    }
  }, [navigate, session]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await submitEmailPasswordAuth(mode, form);
      await refreshSession();
      await navigate("/chat", { replace: true });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "We could not complete that request.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login-layout">
      <section className="login-panel">
        <div className="login-badge">Campus Agent</div>
        <div className="login-copy">
          <h1>{mode === "sign-in" ? "Public campus chat" : "Create your chat account"}</h1>
          <p>
            This Worker-hosted surface stays on the shared app-api contract for auth,
            conversation history, and answer execution.
          </p>
        </div>

        <div aria-label="Authentication mode" className="login-mode-switch" role="tablist">
          <button
            aria-selected={mode === "sign-in"}
            className="login-mode-button"
            onClick={() => setMode("sign-in")}
            role="tab"
            type="button"
          >
            Sign in
          </button>
          <button
            aria-selected={mode === "sign-up"}
            className="login-mode-button"
            onClick={() => setMode("sign-up")}
            role="tab"
            type="button"
          >
            Sign up
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
              required
              type="email"
              value={form.email}
            />
          </label>

          {mode === "sign-up" ? (
            <label className="field">
              <span>Name</span>
              <input
                autoComplete="name"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
                type="text"
                value={form.name}
              />
            </label>
          ) : null}

          <label className="field">
            <span>Password</span>
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              required
              type="password"
              value={form.password}
            />
          </label>

          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Working..." : mode === "sign-in" ? "Continue to chat" : "Create account"}
          </button>
        </form>
      </section>

      <aside className="login-aside">
        <p className="login-aside__eyebrow">Same-site edge surface</p>
        <h2>One browser app, one shared backend seam.</h2>
        <ul className="login-aside__list">
          <li>session and auth stay on app-api</li>
          <li>first-turn prompts create conversations lazily</li>
          <li>chat history lives behind the same Worker boundary</li>
        </ul>
      </aside>
    </main>
  );
}

function ChatHomePage() {
  const navigate = useNavigate();
  const {
    historyError,
    historyLoading,
    session,
    setSessionUnauthenticated,
    upsertConversationSummary,
  } = usePublicChatAppContext();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSendPrompt = async (prompt: string) => {
    setSubmitting(true);
    setError(null);

    try {
      const answer = await submitChatRequest({ prompt });
      upsertConversationSummary(answer.conversation);
      await navigate(`/chat/${answer.conversation.id}`);
      return true;
    } catch (submitError) {
      if (submitError instanceof UnauthorizedError) {
        setSessionUnauthenticated();
        await navigate("/login", { replace: true });
        return false;
      }

      setError(
        submitError instanceof Error ? submitError.message : "Unable to start this conversation.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDraft = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const conversation = await createDraftConversation();
      upsertConversationSummary(conversation);
      await navigate(`/chat/${conversation.id}`);
    } catch (createError) {
      if (createError instanceof UnauthorizedError) {
        setSessionUnauthenticated();
        await navigate("/login", { replace: true });
        return;
      }

      setError(
        createError instanceof Error ? createError.message : "Unable to create a draft thread.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ChatShell
      activeConversationId={null}
      headerDescription="Start directly with a question, or create an empty draft if you need a saved thread first."
      headerTitle="New chat"
    >
      <div className="thread-frame">
        <div className="empty-state-card">
          <p className="eyebrow">Public chat</p>
          <h1>Ask a campus question in one step.</h1>
          <p className="lede">
            First-turn prompts now go straight to the shared app-api command path. No
            pre-created conversation is required unless you explicitly want an empty draft.
          </p>

          <div className="empty-state-actions">
            <button className="secondary-button" disabled={submitting} onClick={handleCreateDraft} type="button">
              Create empty draft
            </button>
          </div>

          {error || historyError ? (
            <p className="inline-error" role="alert">
              {error || historyError}
            </p>
          ) : null}
        </div>

        <Composer
          disabled={submitting || session.kind !== "authenticated"}
          draftKey="new"
          onSubmit={handleSendPrompt}
          placeholder="Ask about campus policies, handbook rules, or service workflows..."
          submitting={submitting}
        />

        <SidebarMetaNote historyLoading={historyLoading} />
      </div>
    </ChatShell>
  );
}

function ChatThreadPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const { historyError, historyLoading, setSessionUnauthenticated, upsertConversationSummary } =
    usePublicChatAppContext();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadConversation = useEffectEvent(async () => {
    if (!conversationId) {
      setConversation(null);
      setLoading(false);
      setError("Conversation id is missing.");
      return;
    }

    startTransition(() => {
      setLoading(true);
      setError(null);
    });

    try {
      const detail = await getConversationDetail(conversationId);
      startTransition(() => {
        setConversation(detail);
        setLoading(false);
      });
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        setSessionUnauthenticated();
        await navigate("/login", { replace: true });
        return;
      }

      startTransition(() => {
        setConversation(null);
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : "Unable to load this conversation.");
      });
    }
  });

  useEffect(() => {
    void loadConversation();
  }, [conversationId, loadConversation]);

  const handleSendPrompt = async (prompt: string) => {
    if (!conversationId) {
      setError("Conversation id is missing.");
      return false;
    }

    setSubmitting(true);
    setError(null);

    try {
      const answer = await submitChatRequest({
        conversationId,
        prompt,
      });
      setConversation(answer.conversation);
      upsertConversationSummary(answer.conversation);
      return true;
    } catch (submitError) {
      if (submitError instanceof UnauthorizedError) {
        setSessionUnauthenticated();
        await navigate("/login", { replace: true });
        return false;
      }

      setError(
        submitError instanceof Error ? submitError.message : "Unable to send this message.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ChatShell
      activeConversationId={conversationId ?? null}
      headerDescription="Replies stay attached to the canonical conversation returned by app-api."
      headerTitle={conversation?.title ?? "Conversation"}
    >
      <div className="thread-frame">
        {loading ? (
          <RouteStatusCard message="Loading this conversation..." title="Preparing thread" />
        ) : conversation ? (
          <MessageList messages={conversation.messages} />
        ) : (
          <RouteStatusCard
            actionLabel="Back to new chat"
            message={error || historyError || "This conversation is unavailable."}
            onAction={() => navigate("/chat")}
            title="Conversation unavailable"
          />
        )}

        {conversation ? (
          <Composer
            disabled={submitting}
            draftKey={conversation.id}
            onSubmit={handleSendPrompt}
            placeholder="Reply with another campus question or follow-up..."
            submitting={submitting}
          />
        ) : null}

        <SidebarMetaNote historyLoading={historyLoading} />
      </div>
    </ChatShell>
  );
}

function ChatShell(props: {
  activeConversationId: string | null;
  children: ReactNode;
  headerDescription: string;
  headerTitle: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { conversations, historyError, historyLoading, refreshConversations, session, setSessionUnauthenticated } =
    usePublicChatAppContext();

  const handleSignOut = async () => {
    try {
      await signOutChatSession();
    } finally {
      setSessionUnauthenticated();
      await navigate("/login", { replace: true });
    }
  };

  const principal =
    session.kind === "authenticated"
      ? session.principal.principal
      : {
          displayName: "Guest",
          email: null,
        };

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <div className="chat-sidebar__brand">
          <div className="chat-sidebar__mark">CA</div>
          <div>
            <p className="chat-sidebar__eyebrow">Public surface</p>
            <h1>Campus Agent</h1>
          </div>
        </div>

        <div className="chat-sidebar__actions">
          <button className="primary-button" onClick={() => navigate("/chat")} type="button">
            New chat
          </button>
          <button className="ghost-button" onClick={() => void refreshConversations()} type="button">
            Refresh list
          </button>
        </div>

        <nav aria-label="Conversation history" className="chat-history">
          {historyLoading ? <p className="sidebar-hint">Refreshing conversation history…</p> : null}
          {historyError ? (
            <p className="inline-error sidebar-inline-error" role="alert">
              {historyError}
            </p>
          ) : null}
          {conversations.length === 0 && !historyLoading ? (
            <p className="sidebar-hint">Your saved conversations will appear here.</p>
          ) : null}

          {conversations.map((conversation) => {
            const isActive = props.activeConversationId === conversation.id;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={`history-link${isActive ? " history-link--active" : ""}`}
                key={conversation.id}
                to={`/chat/${conversation.id}`}
              >
                <span className="history-link__title">{getConversationPreview(conversation)}</span>
                <span className="history-link__meta">
                  {formatConversationTimestamp(conversation.updatedAt)}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="chat-sidebar__footer">
          <div>
            <p className="chat-sidebar__user">{principal.displayName}</p>
            <p className="chat-sidebar__email">{principal.email || "Signed-in app user"}</p>
          </div>
          {location.pathname !== "/login" ? (
            <button className="ghost-button" onClick={() => void handleSignOut()} type="button">
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <main className="chat-main">
        <header className="thread-header">
          <div>
            <p className="eyebrow">Same-site Worker shell</p>
            <h2>{props.headerTitle}</h2>
          </div>
          <p className="thread-header__description">{props.headerDescription}</p>
        </header>

        {props.children}
      </main>
    </div>
  );
}

function MessageList(props: { messages: ConversationDetail["messages"] }) {
  return (
    <section className="message-list">
      {props.messages.map((message) => (
        <article
          className={`message-card message-card--${message.role}`}
          key={message.id}
        >
          <div className="message-card__meta">
            <span>{message.role === "user" ? "You" : formatAssistantLabel(message.kind)}</span>
            <time dateTime={message.createdAt}>{formatConversationTimestamp(message.createdAt)}</time>
          </div>
          <p>{message.text}</p>
        </article>
      ))}
    </section>
  );
}

function formatAssistantLabel(kind: ConversationDetail["messages"][number]["kind"]) {
  if (kind === "clarification") {
    return "Assistant · clarification";
  }
  if (kind === "no_answer") {
    return "Assistant · no answer";
  }
  if (kind === "error") {
    return "Assistant · error";
  }

  return "Assistant";
}

function Composer(props: {
  disabled?: boolean;
  draftKey: string;
  onSubmit: (prompt: string) => Promise<boolean>;
  placeholder: string;
  submitting?: boolean;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [props.draftKey]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const success = await props.onSubmit(normalized);
    if (success) {
      setValue("");
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label className="composer__field">
        <span className="sr-only">Prompt</span>
        <textarea
          disabled={props.disabled}
          onChange={(event) => setValue(event.target.value)}
          placeholder={props.placeholder}
          rows={4}
          value={value}
        />
      </label>
      <div className="composer__actions">
        <p className="composer__hint">Enter sends after submit. Keep requests specific for better grounding.</p>
        <button className="primary-button" disabled={props.disabled || props.submitting} type="submit">
          {props.submitting ? "Sending..." : "Send"}
        </button>
      </div>
    </form>
  );
}

function RouteStatusCard(props: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="route-card">
      <p className="eyebrow">Public chat status</p>
      <h3>{props.title}</h3>
      <p className="lede">{props.message}</p>
      {props.actionLabel && props.onAction ? (
        <button className="secondary-button" onClick={props.onAction} type="button">
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function SidebarMetaNote(props: { historyLoading: boolean }) {
  return (
    <footer className="thread-note">
      <span>{props.historyLoading ? "Syncing saved threads…" : "Saved threads stay in app-api."}</span>
      <span>Requests still traverse the same Worker seam.</span>
    </footer>
  );
}
