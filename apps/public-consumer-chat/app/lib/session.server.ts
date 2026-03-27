import { getPublicChatAuth } from "./auth.server";
import { readPublicChatServerEnv } from "./env.server";

export type AuthenticatedUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

type BetterAuthSession = {
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
  } | null;
} | null;

type SessionReader = {
  api: {
    getSession(input: { headers: Headers }): Promise<BetterAuthSession>;
  };
};

export async function getServerSession(
  request: Request,
  input?: {
    auth?: SessionReader;
  },
): Promise<BetterAuthSession> {
  const auth = input?.auth ?? getPublicChatAuth(readPublicChatServerEnv());
  return auth.api.getSession({
    headers: request.headers,
  });
}

export async function getAuthenticatedUser(
  request: Request,
  input?: {
    auth?: SessionReader;
  },
): Promise<AuthenticatedUser | null> {
  const session = await getServerSession(request, input);

  if (!session?.user?.id) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
}
