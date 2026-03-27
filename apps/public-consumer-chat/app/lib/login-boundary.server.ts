import { getAuthenticatedUser } from "./session.server";
import type { AuthenticatedUser } from "./session.server";

type GetUserFn = typeof getAuthenticatedUser;

export class AuthenticatedAppUserRedirectError extends Error {
  readonly redirectTo: "/chat";

  constructor() {
    super("Authenticated app users should be routed to /chat.");
    this.name = "AuthenticatedAppUserRedirectError";
    this.redirectTo = "/chat";
  }
}

export async function loadLoginPageData(input: {
  getUser?: GetUserFn;
  request: Request;
}): Promise<{ redirectTo: null }> {
  const getUser = input.getUser ?? getAuthenticatedUser;
  const user = await getUser(input.request);

  if (isAuthenticatedUser(user)) {
    throw new AuthenticatedAppUserRedirectError();
  }

  return {
    redirectTo: null,
  };
}

function isAuthenticatedUser(user: AuthenticatedUser | null): user is AuthenticatedUser {
  return Boolean(user?.id);
}
