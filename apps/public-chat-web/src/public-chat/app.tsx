import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  startTransition,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";

import {
  UnauthorizedError,
  getSessionPrincipal,
  listConversations,
} from "./api";
import {
  submitEmailPasswordAuth,
  type AuthFormState,
  type AuthMode,
} from "./auth";
import {
  PublicChatAppContext,
  type PublicChatAppContextValue,
  type SessionState,
  upsertConversationSummaryList,
  usePublicChatAppContext,
} from "./context";
import type {
  ConversationSummary,
} from "./types";

const ChatbotShellPage = lazy(async () => {
  const module = await import("../chatbot-shell/shell-page");

  return {
    default: module.ChatbotShellPage,
  };
});

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
  }, []);

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
  }, [session]);

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
          setConversations((current) => upsertConversationSummaryList(current, conversation));
        });
      },
    }),
    [conversations, historyError, historyLoading, session],
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
                <Suspense
                  fallback={
                    <RouteStatusCard
                      message="Loading the donor-derived shell..."
                      title="Preparing chat"
                    />
                  }
                >
                  <ChatbotShellPage />
                </Suspense>
              </RequireAuthenticatedChat>
            }
            path="/chat"
          />
          <Route
            element={
              <RequireAuthenticatedChat>
                <Suspense
                  fallback={
                    <RouteStatusCard
                      message="Loading the donor-derived shell..."
                      title="Preparing chat"
                    />
                  }
                >
                  <ChatbotShellPage />
                </Suspense>
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
