import { useEffect, useState } from "react";

import {
  submitEmailPasswordAuth,
  type AuthFormState,
  type AuthMode,
} from "@platform/auth/client";
import { useChatbotShellRuntime } from "@platform/chat/runtime";
import { useAppRouter } from "@platform/router";

export function LoginPage() {
  const router = useAppRouter();
  const { refreshSession, session } = useChatbotShellRuntime();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [form, setForm] = useState<AuthFormState>({
    email: "",
    name: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (session.kind === "authenticated" && session.principal.canChat) {
      void router.replace("/chat");
    }
  }, [router, session]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await submitEmailPasswordAuth(mode, form);
      await refreshSession();
      await router.replace("/chat");
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
          <label className="field" htmlFor="login-email">
            <span>Email</span>
            <input
              autoComplete="email"
              id="login-email"
              name="email"
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
            <label className="field" htmlFor="login-name">
              <span>Name</span>
              <input
                autoComplete="name"
                id="login-name"
                name="name"
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

          <label className="field" htmlFor="login-password">
            <span>Password</span>
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              id="login-password"
              minLength={8}
              name="password"
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

          {error ? <p className="field-error">{error}</p> : null}

          <button className="login-submit" disabled={pending} type="submit">
            {pending
              ? "Working..."
              : mode === "sign-in"
                ? "Sign in to chat"
                : "Create account and continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
