import { createFileRoute } from "@tanstack/react-router";

import { PgConversationRepository } from "../lib/conversations.server";
import {
  createSupabasePool,
  ensurePublicChatDatabaseReady,
} from "../lib/db.server";
import { readPublicChatServerEnv } from "../lib/env.server";
import { jsonResponse } from "../lib/http";
import { getAuthenticatedUser } from "../lib/session.server";

export const Route = createFileRoute("/api/conversations")({
  server: {
    handlers: {
      GET: async ({ request }) => listConversationsHandler(request),
      POST: async ({ request }) => createConversationHandler(request),
      DELETE: async ({ request }) => deleteAllConversationsHandler(request),
    },
  },
});

export async function listConversationsHandler(request: Request): Promise<Response> {
  const env = readPublicChatServerEnv();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const pool = createSupabasePool(env);
  await ensurePublicChatDatabaseReady(pool, env);
  const repository = new PgConversationRepository(pool, env.chatSchema);
  const conversations = await repository.listByOwner(user.id);
  return jsonResponse({ conversations });
}

export async function createConversationHandler(request: Request): Promise<Response> {
  const env = readPublicChatServerEnv();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const pool = createSupabasePool(env);
  await ensurePublicChatDatabaseReady(pool, env);
  const repository = new PgConversationRepository(pool, env.chatSchema);
  const conversation = await repository.create(user.id);
  return jsonResponse({ conversation }, { status: 201 });
}

export async function deleteAllConversationsHandler(request: Request): Promise<Response> {
  const env = readPublicChatServerEnv();
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const pool = createSupabasePool(env);
  await ensurePublicChatDatabaseReady(pool, env);
  const repository = new PgConversationRepository(pool, env.chatSchema);
  await repository.deleteAllByOwner(user.id);
  return jsonResponse({ ok: true });
}
