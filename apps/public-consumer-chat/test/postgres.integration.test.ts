// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPublicChatServerEnv } from "../app/lib/env.server";
import { qualifyTable } from "../app/lib/db.server";
import { handleAuthRequest } from "../app/routes/api.auth.$";
import {
  createConversationHandler,
  deleteAllConversationsHandler,
} from "../app/routes/api.conversations";
import {
  deleteConversationHandler,
  getConversationHandler,
} from "../app/routes/api.conversations.$conversationId";
import { answerHandler } from "../app/routes/api.answer";
import { bootstrapDatabase } from "../scripts/lib/database-bootstrap.mjs";
import { Pool } from "pg";

const testDatabaseUrl =
  process.env.PUBLIC_CHAT_TEST_DATABASE_URL ??
  process.env.PUBLIC_CONSUMER_CHAT_DATABASE_URL;
const hasIntegrationDatabase = Boolean(testDatabaseUrl);
const appBaseUrl =
  process.env.PUBLIC_CONSUMER_CHAT_APP_BASE_URL ?? "http://127.0.0.1:3000";
const betterAuthSecret =
  process.env.BETTER_AUTH_SECRET ?? "dev-secret-dev-secret-dev-secret";

const originalEnv = { ...process.env };

const readJson = async (response: Response) => response.json();

const buildCookieHeader = (response: Response): string => {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected auth response to include a session cookie.");
  }

  return setCookie.split(",").map((value) => value.split(";", 1)[0]).join("; ");
};

const signUpAppUser = async (input: {
  email: string;
  name: string;
  password: string;
}): Promise<string> => {
  const authResponse = await handleAuthRequest(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: appBaseUrl,
        referer: `${appBaseUrl}/login`,
      },
      body: JSON.stringify(input),
    }),
  );

  expect(authResponse.ok).toBe(true);
  return buildCookieHeader(authResponse);
};

const createConversationForCookie = async (cookieHeader: string): Promise<string> => {
  const createResponse = await createConversationHandler(
    new Request(`${appBaseUrl}/api/conversations`, {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
  );
  const createPayload = (await readJson(createResponse)) as {
    conversation: { id: string };
  };

  expect(createResponse.status).toBe(201);
  expect(createPayload.conversation.id).toBeTruthy();
  return createPayload.conversation.id;
};

describe.skipIf(!hasIntegrationDatabase)(
  "public-consumer-chat postgres integration",
  () => {
    beforeAll(async () => {
      process.env.PUBLIC_CHAT_MODE = "mock";
      process.env.PUBLIC_CONSUMER_CHAT_APP_BASE_URL = appBaseUrl;
      process.env.PUBLIC_CONSUMER_CHAT_DATABASE_URL = testDatabaseUrl;
      process.env.PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE =
        process.env.PUBLIC_CONSUMER_CHAT_DATABASE_SSLMODE ?? "require";
      process.env.PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA =
        process.env.PUBLIC_CONSUMER_CHAT_AUTH_SCHEMA ?? "auth";
      process.env.PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA =
        process.env.PUBLIC_CONSUMER_CHAT_CHAT_SCHEMA ?? "chat";
      process.env.PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA =
        process.env.PUBLIC_CONSUMER_CHAT_INGESTION_REGISTRY_SCHEMA ??
        "ingestion_registry";
      process.env.BETTER_AUTH_SECRET = betterAuthSecret;

      await bootstrapDatabase(process.env);
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it(
      "signs in, creates a conversation, and appends an answer turn in Postgres",
      async () => {
        const cookieHeader = await signUpAppUser({
          email: `integration-${Date.now()}@example.com`,
          name: "Integration Student",
          password: "password123",
        });
        const conversationId = await createConversationForCookie(cookieHeader);

        const answerResponse = await answerHandler(
          new Request(`${appBaseUrl}/api/answer`, {
            method: "POST",
            headers: {
              cookie: cookieHeader,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              conversationId,
              prompt: "图书馆开放到几点？",
            }),
          }),
        );
        const answerPayload = (await readJson(answerResponse)) as {
          answer: {
            conversation: {
              id: string;
              messages: Array<{ role: string }>;
            };
            result: { kind: string };
          };
        };

        expect(answerResponse.ok).toBe(true);
        expect(answerPayload.answer.result.kind).toBeTruthy();
        expect(answerPayload.answer.conversation.messages).toHaveLength(2);

        const getResponse = await getConversationHandler(
          new Request(
            `${appBaseUrl}/api/conversations/${conversationId}`,
            {
              method: "GET",
              headers: {
                cookie: cookieHeader,
              },
            },
          ),
          conversationId,
        );
        const getPayload = (await readJson(getResponse)) as {
          conversation: {
            id: string;
            messages: Array<{ role: string }>;
          };
        };

        expect(getResponse.ok).toBe(true);
        expect(getPayload.conversation.id).toBe(conversationId);
        expect(getPayload.conversation.messages.map((message) => message.role)).toEqual([
          "user",
          "assistant",
        ]);

        const cleanupResponse = await deleteAllConversationsHandler(
          new Request(`${appBaseUrl}/api/conversations`, {
            method: "DELETE",
            headers: {
              cookie: cookieHeader,
            },
          }),
        );

        expect(cleanupResponse.ok).toBe(true);
      },
      30_000,
    );

    it("rejects unauthenticated conversation and answer access", async () => {
      const createResponse = await createConversationHandler(
        new Request(`${appBaseUrl}/api/conversations`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        }),
      );
      expect(createResponse.status).toBe(401);

      const listResponse = await deleteAllConversationsHandler(
        new Request(`${appBaseUrl}/api/conversations`, {
          method: "DELETE",
        }),
      );
      expect(listResponse.status).toBe(401);

      const answerResponse = await answerHandler(
        new Request(`${appBaseUrl}/api/answer`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            conversationId: "conv-missing",
            prompt: "图书馆开放到几点？",
          }),
        }),
      );
      expect(answerResponse.status).toBe(401);
    });

    it(
      "enforces ownership and cascades messages when deleting a conversation",
      async () => {
        const ownerCookie = await signUpAppUser({
          email: `owner-${Date.now()}@example.com`,
          name: "Owner Student",
          password: "password123",
        });
        const otherUserCookie = await signUpAppUser({
          email: `other-${Date.now()}@example.com`,
          name: "Other Student",
          password: "password123",
        });
        const conversationId = await createConversationForCookie(ownerCookie);

        const answerResponse = await answerHandler(
          new Request(`${appBaseUrl}/api/answer`, {
            method: "POST",
            headers: {
              cookie: ownerCookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              conversationId,
              prompt: "图书馆开放到几点？",
            }),
          }),
        );
        expect(answerResponse.ok).toBe(true);

        const foreignGetResponse = await getConversationHandler(
          new Request(`${appBaseUrl}/api/conversations/${conversationId}`, {
            method: "GET",
            headers: {
              cookie: otherUserCookie,
            },
          }),
          conversationId,
        );
        expect(foreignGetResponse.status).toBe(404);

        const foreignDeleteResponse = await deleteConversationHandler(
          new Request(`${appBaseUrl}/api/conversations/${conversationId}`, {
            method: "DELETE",
            headers: {
              cookie: otherUserCookie,
            },
          }),
          conversationId,
        );
        expect(foreignDeleteResponse.status).toBe(404);

        const foreignAnswerResponse = await answerHandler(
          new Request(`${appBaseUrl}/api/answer`, {
            method: "POST",
            headers: {
              cookie: otherUserCookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              conversationId,
              prompt: "Can I read someone else's thread?",
            }),
          }),
        );
        expect(foreignAnswerResponse.status).toBe(404);

        const deleteResponse = await deleteConversationHandler(
          new Request(`${appBaseUrl}/api/conversations/${conversationId}`, {
            method: "DELETE",
            headers: {
              cookie: ownerCookie,
            },
          }),
          conversationId,
        );
        expect(deleteResponse.ok).toBe(true);

        const getAfterDeleteResponse = await getConversationHandler(
          new Request(`${appBaseUrl}/api/conversations/${conversationId}`, {
            method: "GET",
            headers: {
              cookie: ownerCookie,
            },
          }),
          conversationId,
        );
        expect(getAfterDeleteResponse.status).toBe(404);

        const env = readPublicChatServerEnv();
        const pool = new Pool({
          connectionString: env.databaseUrl,
          ssl:
            env.databaseSslMode === "disable"
              ? false
              : {
                  rejectUnauthorized: false,
                },
        });

        try {
          const result = await pool.query<{ message_count: string }>(
            `SELECT COUNT(*)::text AS message_count FROM ${qualifyTable(env.chatSchema, "messages")} WHERE conversation_id = $1`,
            [conversationId],
          );
          expect(Number(result.rows[0]?.message_count ?? "0")).toBe(0);
        } finally {
          await pool.end();
        }
      },
      30_000,
    );

    it(
      "persists a stable error turn when live upstream is unavailable",
      async () => {
        const previousMode = process.env.PUBLIC_CHAT_MODE;
        const previousAnswerBaseUrl = process.env.SUPERVISOR_API_BASE_URL;
        const previousAnswerBearerToken = process.env.SUPERVISOR_API_BEARER_TOKEN;

        process.env.PUBLIC_CHAT_MODE = "live";
        process.env.SUPERVISOR_API_BASE_URL = "http://127.0.0.1:9";
        delete process.env.SUPERVISOR_API_BEARER_TOKEN;

        try {
          const cookieHeader = await signUpAppUser({
            email: `live-outage-${Date.now()}@example.com`,
            name: "Live Outage Student",
            password: "password123",
          });
          const conversationId = await createConversationForCookie(cookieHeader);

          const answerResponse = await answerHandler(
            new Request(`${appBaseUrl}/api/answer`, {
              method: "POST",
              headers: {
                cookie: cookieHeader,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                conversationId,
                prompt: "图书馆开放到几点？",
              }),
            }),
          );
          const answerPayload = (await readJson(answerResponse)) as {
            answer: {
              conversation: {
                id: string;
                messages: Array<{
                  role: string;
                  text: string;
                  kind?: string;
                  requestId?: string;
                  retryable?: boolean;
                }>;
              };
              result: { kind: string; message?: string; request_id?: string };
            };
          };

          expect(answerResponse.ok).toBe(true);
          expect(answerPayload.answer.result.kind).toBe("error");
          expect(answerPayload.answer.result.message).toContain(
            "The public answer path is unavailable right now.",
          );
          expect(answerPayload.answer.conversation.id).toBe(conversationId);
          expect(answerPayload.answer.conversation.messages).toHaveLength(2);
          expect(answerPayload.answer.conversation.messages[1]?.role).toBe("assistant");
          expect(answerPayload.answer.conversation.messages[1]?.kind).toBe("error");
          expect(answerPayload.answer.conversation.messages[1]?.text).toContain(
            "The public answer path is unavailable right now.",
          );
          expect(answerPayload.answer.result.request_id).toMatch(/^req-/);
          expect(answerPayload.answer.conversation.messages[1]?.requestId).toMatch(/^req-/);
          expect(answerPayload.answer.conversation.messages[1]?.retryable).toBe(true);
        } finally {
          if (previousMode) {
            process.env.PUBLIC_CHAT_MODE = previousMode;
          } else {
            delete process.env.PUBLIC_CHAT_MODE;
          }

          if (previousAnswerBaseUrl) {
            process.env.SUPERVISOR_API_BASE_URL = previousAnswerBaseUrl;
          } else {
            delete process.env.SUPERVISOR_API_BASE_URL;
          }

          if (previousAnswerBearerToken) {
            process.env.SUPERVISOR_API_BEARER_TOKEN = previousAnswerBearerToken;
          } else {
            delete process.env.SUPERVISOR_API_BEARER_TOKEN;
          }
        }
      },
      30_000,
    );
  },
);
