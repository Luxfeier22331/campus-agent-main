"use client";

import { useEffect, useId, useRef, useState } from "react";

const AUTH_RUNTIME_CONFIG_SCRIPT_ID = "__PUBLIC_CHAT_AUTH_CONFIG__";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type AuthTurnstileAction = "sign-in" | "sign-up" | "request-password-reset";

type TurnstileRuntimeConfig = {
  turnstileSiteKey: string | null;
};

type TurnstileWidget = {
  remove?: (widgetId: string) => void;
  render: (
    container: HTMLElement | string,
    options: Record<string, unknown>,
  ) => string;
};

declare global {
  interface Window {
    turnstile?: TurnstileWidget;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function readTurnstileRuntimeConfig(): TurnstileRuntimeConfig {
  if (typeof document === "undefined") {
    return { turnstileSiteKey: null };
  }

  const script = document.getElementById(AUTH_RUNTIME_CONFIG_SCRIPT_ID);
  const source = script?.textContent?.trim();
  if (!source) {
    return { turnstileSiteKey: null };
  }

  try {
    const parsed = JSON.parse(source) as {
      turnstileSiteKey?: unknown;
    };
    const turnstileSiteKey =
      typeof parsed.turnstileSiteKey === "string" &&
      parsed.turnstileSiteKey.trim().length > 0
        ? parsed.turnstileSiteKey.trim()
        : null;
    return { turnstileSiteKey };
  } catch {
    return { turnstileSiteKey: null };
  }
}

async function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  if (window.turnstile) {
    return;
  }
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-auth-turnstile="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Turnstile script failed to load.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.authTurnstile = "true";
    script.defer = true;
    script.src = TURNSTILE_SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed to load."));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

export function AuthTurnstileField(props: { action: AuthTurnstileAction }) {
  const { action } = props;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [siteKey, setSiteKey] = useState<string | null>(() =>
    readTurnstileRuntimeConfig().turnstileSiteKey,
  );
  const containerId = useId();
  const widgetIdRef = useRef<string | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSiteKey(readTurnstileRuntimeConfig().turnstileSiteKey);
  }, []);

  useEffect(() => {
    if (!siteKey || !widgetRef.current) {
      return;
    }

    let cancelled = false;

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !widgetRef.current || !window.turnstile) {
          return;
        }

        setErrorMessage(null);
        widgetIdRef.current = window.turnstile.render(widgetRef.current, {
          action,
          callback(value: unknown) {
            setToken(typeof value === "string" ? value : "");
            setErrorMessage(null);
          },
          "error-callback"() {
            setToken("");
            setErrorMessage("Security verification failed. Try again.");
          },
          "expired-callback"() {
            setToken("");
            setErrorMessage("Security verification expired. Complete it again.");
          },
          sitekey: siteKey,
          theme: "auto",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage("Security verification is unavailable right now.");
        }
      });

    return () => {
      cancelled = true;
      setToken("");
      if (widgetIdRef.current && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
      } else if (widgetRef.current) {
        widgetRef.current.innerHTML = "";
      }
      widgetIdRef.current = null;
    };
  }, [action, siteKey]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/40 bg-muted/30 px-3 py-3">
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-foreground">
          Complete the security check before continuing.
        </p>
        <p className="text-[12px] text-muted-foreground">
          This keeps sign-in, registration, and recovery on the same protected
          auth path.
        </p>
      </div>
      <input name="captchaToken" readOnly type="hidden" value={token} />
      {siteKey ? (
        <div data-slot="auth-turnstile" id={containerId} ref={widgetRef} />
      ) : (
        <p className="text-[12px] text-destructive">
          Security verification is unavailable right now.
        </p>
      )}
      {errorMessage ? (
        <p className="text-[12px] text-destructive">{errorMessage}</p>
      ) : null}
    </div>
  );
}
