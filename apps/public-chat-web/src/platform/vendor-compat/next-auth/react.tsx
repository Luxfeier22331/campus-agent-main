import { useContext, type ReactNode } from "react";

import { signOutChatSession } from "@platform/auth/client";
import { ChatbotShellRuntimeContext } from "@platform/chat/runtime";

import type { Session, User } from "./index";

type SessionStatus = "authenticated" | "loading" | "unauthenticated";

function buildSession(input: {
  displayName: string;
  email: string | null;
} | null): Session | null {
  if (!input) {
    return null;
  }

  const user: User = {
    email: input.email,
    name: input.displayName,
  };

  return { user };
}

export function SessionProvider(props: { basePath?: string; children: ReactNode }) {
  const { children } = props;
  return <>{children}</>;
}

export async function signOut(options?: {
  callbackUrl?: string;
  redirectTo?: string;
}) {
  const redirectTo = options?.redirectTo ?? options?.callbackUrl;
  await signOutChatSession({ redirectTo });

  return {
    url: redirectTo ?? null,
  };
}

export function useSession() {
  const runtime = useContext(ChatbotShellRuntimeContext);

  if (!runtime) {
    return {
      data: null as Session | null,
      status: "unauthenticated" as SessionStatus,
      update: async () => null as Session | null,
    };
  }

  const { refreshSession, session } = runtime;
  const data =
    session.kind === "authenticated" ? buildSession(session.principal) : null;
  const status: SessionStatus =
    session.kind === "loading"
      ? "loading"
      : session.kind === "authenticated"
        ? "authenticated"
        : "unauthenticated";

  return {
    data,
    status,
    update: async () => {
      await refreshSession();
      return data;
    },
  };
}
