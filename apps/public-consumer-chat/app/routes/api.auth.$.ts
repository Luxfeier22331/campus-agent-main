import { createFileRoute } from "@tanstack/react-router";

import { getPublicChatAuth } from "../lib/auth.server";
import { readPublicChatServerEnv } from "../lib/env.server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => handleAuthRequest(request),
      POST: async ({ request }) => handleAuthRequest(request),
    },
  },
});

export async function handleAuthRequest(request: Request): Promise<Response> {
  const env = readPublicChatServerEnv();
  const auth = getPublicChatAuth(env);
  return auth.handler(request);
}
