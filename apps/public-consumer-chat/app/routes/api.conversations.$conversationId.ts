import { createFileRoute } from "@tanstack/react-router";

import { PgConversationRepository } from "../lib/conversations.server";
import {
  createSupabasePool,
  ensurePublicChatDatabaseReady,
} from "../lib/db.server";
import { readPublicChatServerEnv } from "../lib/env.server";
import { jsonResponse } from "../lib/http";
import { getAuthenticatedUser } from "../lib/session.server";

export const Route = createFileRoute("/api/conversations/$conversationId")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        getConversationHandler(request, params.conversationId),
      DELETE: async ({ params, request }) =>
        deleteConversationHandler(request, params.conversationId),
    },
  },
});

export async function getConversationHandler(
  request: Request,
  conversationId: string,
): Promise<Response> {
  const env = readPublicChatServerEnv();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const pool = createSupabasePool(env);
  await ensurePublicChatDatabaseReady(pool, env);
  const repository = new PgConversationRepository(pool, env.chatSchema);
  const conversation = await repository.getByOwner(user.id, conversationId);

  if (!conversation) {
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  return jsonResponse({ conversation });
}

export async function deleteConversationHandler(
  request: Request,
  conversationId: string,
): Promise<Response> {
  const env = readPublicChatServerEnv();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const pool = createSupabasePool(env);
  await ensurePublicChatDatabaseReady(pool, env);
  const repository = new PgConversationRepository(pool, env.chatSchema);
  const deleted = await repository.deleteByOwner(user.id, conversationId);

  if (!deleted) {
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  return jsonResponse({ ok: true });
}
