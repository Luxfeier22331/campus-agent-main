import { createFileRoute } from "@tanstack/react-router";

import { requestPublicAnswer } from "../lib/answer-runtime.server";
import { PgConversationRepository } from "../lib/conversations.server";
import {
  createSupabasePool,
  ensurePublicChatDatabaseReady,
} from "../lib/db.server";
import { readPublicChatServerEnv } from "../lib/env.server";
import { jsonResponse } from "../lib/http";
import { getAuthenticatedUser } from "../lib/session.server";

export const Route = createFileRoute("/api/answer")({
  server: {
    handlers: {
      POST: async ({ request }) => answerHandler(request),
    },
  },
});

export async function answerHandler(request: Request): Promise<Response> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => undefined)) as
    | {
        conversationId?: unknown;
        prompt?: unknown;
      }
    | undefined;

  if (
    !payload ||
    typeof payload.conversationId !== "string" ||
    typeof payload.prompt !== "string" ||
    !payload.prompt.trim()
  ) {
    return jsonResponse(
      {
        error: "conversationId and prompt are required",
      },
      { status: 400 },
    );
  }

  const env = readPublicChatServerEnv();
  const pool = createSupabasePool(env);
  await ensurePublicChatDatabaseReady(pool, env);
  const repository = new PgConversationRepository(pool, env.chatSchema);
  const conversation = await repository.getByOwner(user.id, payload.conversationId);

  if (!conversation) {
    return jsonResponse({ error: "Conversation not found" }, { status: 404 });
  }

  const result = await requestPublicAnswer({
    env,
    conversationId: conversation.id,
    prompt: payload.prompt.trim(),
  });

  const updatedConversation = await repository.appendTurn(
    user.id,
    conversation.id,
    payload.prompt.trim(),
    result,
  );

  if (!updatedConversation) {
    return jsonResponse({ error: "Conversation not found" }, { status: 404 });
  }

  return jsonResponse({
    answer: {
      conversation: updatedConversation,
      result,
    },
  });
}
