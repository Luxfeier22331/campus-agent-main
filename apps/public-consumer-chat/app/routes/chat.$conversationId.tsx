import { useEffect, useState } from "react";

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import type { Conversation } from "../lib/chat-types";
import { ChatPage } from "../components/chat/chat-page";
import { upsertConversationHistory } from "../lib/chat-ui";
import {
  UnauthorizedError,
  answerConversationClient,
  deleteAllConversationsClient,
  deleteConversationClient,
  getConversationClient,
  listConversationsClient,
  signOutClient,
} from "../lib/public-chat-client";

const isUnauthorizedAppAccessError = (error: unknown): boolean =>
  error instanceof Error && error.name === "UnauthorizedAppAccessError";

const isConversationOwnershipError = (error: unknown): boolean =>
  error instanceof Error && error.name === "ConversationOwnershipError";

const loadChatConversationPage = createServerFn({ method: "GET" })
  .inputValidator((data: { conversationId: string }) => data)
  .handler(async ({ data }) => {
    const { loadChatConversationPageRequest } = await import(
      "../lib/chat-boundary.server"
    );
    return loadChatConversationPageRequest({
      conversationId: data.conversationId,
      request: getRequest(),
    });
  });

export const Route = createFileRoute("/chat/$conversationId")({
  loader: async ({ params }) => {
    try {
      return await loadChatConversationPage({
        data: {
          conversationId: params.conversationId,
        },
      });
    } catch (error) {
      if (isUnauthorizedAppAccessError(error)) {
        throw redirect({
          to: "/login",
        });
      }

      if (isConversationOwnershipError(error)) {
        throw redirect({
          to: "/chat",
        });
      }

      throw error;
    }
  },
  component: ChatConversationPage,
});

function ChatConversationPage() {
  const navigate = useNavigate();
  const { conversationId } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const [conversations, setConversations] = useState<Conversation[]>(
    () => loaderData.conversations,
  );
  const [conversation, setConversation] = useState<Conversation | null>(
    () => loaderData.conversation,
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncConversationPage = async () => {
      setHistoryLoading(true);

      try {
        const [latestConversation, latestConversations] = await Promise.all([
          getConversationClient(conversationId),
          listConversationsClient(),
        ]);

        if (!cancelled) {
          setConversation(latestConversation);
          setConversations(latestConversations);
        }
      } catch (syncError) {
        if (syncError instanceof UnauthorizedError) {
          await navigate({
            to: "/login",
          });
          return;
        }

        if (!cancelled) {
          setError(
            syncError instanceof Error ? syncError.message : "Unable to refresh this conversation.",
          );
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    void syncConversationPage();

    return () => {
      cancelled = true;
    };
  }, [conversationId, navigate]);

  const handleNewConversation = async () => {
    setError(null);
    await navigate({
      to: "/chat",
    });
  };

  const handleSignOut = async () => {
    try {
      await signOutClient();
    } finally {
      await navigate({
        to: "/login",
      });
    }
  };

  const submitPrompt = async (nextPrompt: string): Promise<boolean> => {
    const normalizedPrompt = nextPrompt.trim();
    if (!normalizedPrompt) {
      return false;
    }

    setSubmitting(true);
    setError(null);

    try {
      const answer = await answerConversationClient({
        conversationId,
        prompt: normalizedPrompt,
      });
      setConversation(answer.conversation);
      setConversations((current) => upsertConversationHistory(current, answer.conversation));
      return true;
    } catch (submitError) {
      if (submitError instanceof UnauthorizedError) {
        await navigate({
          to: "/login",
        });
        return false;
      }

      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to send your message.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConversation = async (targetConversationId: string) => {
    try {
      await deleteConversationClient(targetConversationId);
      setConversations((current) =>
        current.filter((item) => item.id !== targetConversationId),
      );
      if (targetConversationId === conversationId) {
        setConversation(null);
      }
      setError(null);
      if (targetConversationId === conversationId) {
        await navigate({
          to: "/chat",
        });
      }
    } catch (deleteError) {
      if (deleteError instanceof UnauthorizedError) {
        await navigate({
          to: "/login",
        });
        return;
      }

      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete this conversation.",
      );
    }
  };

  const handleDeleteAll = async () => {
    try {
      await deleteAllConversationsClient();
      setConversations([]);
      setConversation(null);
      setError(null);
      await navigate({
        to: "/chat",
      });
    } catch (deleteError) {
      if (deleteError instanceof UnauthorizedError) {
        await navigate({
          to: "/login",
        });
        return;
      }

      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete conversations.",
      );
    }
  };

  return (
    <ChatPage
      activeConversationId={conversationId}
      composerDraftKey={conversationId}
      composerPlaceholder="Reply with another campus question or clarification..."
      conversations={conversations}
      error={error}
      headerDescription="Conversation ownership is enforced on the server boundary."
      headerTitle={conversation?.title ?? conversationId}
      historyLoading={historyLoading}
      messages={conversation?.messages ?? []}
      mode="thread"
      onDeleteAll={handleDeleteAll}
      onDeleteConversation={handleDeleteConversation}
      onNewChat={handleNewConversation}
      onRetryPrompt={(prompt) => submitPrompt(prompt)}
      onSendPrompt={submitPrompt}
      onSignOut={handleSignOut}
      submitting={submitting}
      user={loaderData.user}
    />
  );
}
