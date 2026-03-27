import { PgConversationRepository } from "./conversations.server";
import { createSupabasePool, ensurePublicChatDatabaseReady } from "./db.server";
import { readPublicChatServerEnv } from "./env.server";
import { getAuthenticatedUser } from "./session.server";
import type { AuthenticatedUser } from "./session.server";
import type { Conversation } from "./chat-types";

type ChatBoundaryRepository = Pick<
  PgConversationRepository,
  "getByOwner" | "listByOwner"
>;

type GetUserFn = typeof getAuthenticatedUser;

export class UnauthorizedAppAccessError extends Error {
  constructor(message = "Sign in required.") {
    super(message);
    this.name = "UnauthorizedAppAccessError";
  }
}

export class ConversationOwnershipError extends Error {
  constructor(message = "Conversation not found for the current app user.") {
    super(message);
    this.name = "ConversationOwnershipError";
  }
}

async function requireAuthenticatedUser(input: {
  getUser: GetUserFn;
  request: Request;
}): Promise<AuthenticatedUser> {
  const user = await input.getUser(input.request);
  if (!user) {
    throw new UnauthorizedAppAccessError();
  }
  return user;
}

export async function loadChatIndexPageData(input: {
  getUser: GetUserFn;
  repository: ChatBoundaryRepository;
  request: Request;
}): Promise<{ conversations: Conversation[]; user: AuthenticatedUser }> {
  const user = await requireAuthenticatedUser(input);
  const conversations = await input.repository.listByOwner(user.id);

  return {
    conversations,
    user,
  };
}

export async function loadChatConversationPageData(input: {
  conversationId: string;
  getUser: GetUserFn;
  repository: ChatBoundaryRepository;
  request: Request;
}): Promise<{
  conversation: Conversation;
  conversations: Conversation[];
  user: AuthenticatedUser;
}> {
  const user = await requireAuthenticatedUser(input);
  const [conversation, conversations] = await Promise.all([
    input.repository.getByOwner(user.id, input.conversationId),
    input.repository.listByOwner(user.id),
  ]);

  if (!conversation) {
    throw new ConversationOwnershipError();
  }

  return {
    conversation,
    conversations,
    user,
  };
}

async function createRepository(): Promise<PgConversationRepository> {
  const env = readPublicChatServerEnv();
  const pool = createSupabasePool(env);
  await ensurePublicChatDatabaseReady(pool, env);
  return new PgConversationRepository(pool, env.chatSchema);
}

export async function loadChatIndexPageRequest(
  request: Request,
): Promise<{ conversations: Conversation[]; user: AuthenticatedUser }> {
  return loadChatIndexPageData({
    getUser: getAuthenticatedUser,
    repository: await createRepository(),
    request,
  });
}

export async function loadChatConversationPageRequest(input: {
  conversationId: string;
  request: Request;
}): Promise<{
  conversation: Conversation;
  conversations: Conversation[];
  user: AuthenticatedUser;
}> {
  return loadChatConversationPageData({
    conversationId: input.conversationId,
    getUser: getAuthenticatedUser,
    repository: await createRepository(),
    request: input.request,
  });
}
