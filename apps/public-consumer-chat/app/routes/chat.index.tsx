import { useEffect, useState } from "react";

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import type { Conversation } from "../lib/chat-types";
import { ChatPage } from "../components/chat/chat-page";
import { deleteAllConversationsClient } from "../lib/public-chat-client";
import {
  deleteConversationClient,
  UnauthorizedError,
  listConversationsClient,
  signOutClient,
  startConversationClient,
} from "../lib/public-chat-client";
import { upsertConversationHistory } from "../lib/chat-ui";

const isUnauthorizedAppAccessError = (error: unknown): boolean =>
  error instanceof Error && error.name === "UnauthorizedAppAccessError";

const loadChatIndexPage = createServerFn({ method: "GET" }).handler(async () => {
  const { loadChatIndexPageRequest } = await import("../lib/chat-boundary.server");
  return loadChatIndexPageRequest(getRequest());
});

export const Route = createFileRoute("/chat/")({
  loader: async () => {
    try {
      return await loadChatIndexPage();
    } catch (error) {
      if (isUnauthorizedAppAccessError(error)) {
        throw redirect({
          to: "/login",
        });
      }

      throw error;
    }
  },
  component: ChatIndexPage,
});

function ChatIndexPage() {
  const navigate = useNavigate();
  const loaderData = Route.useLoaderData();
  const [conversations, setConversations] = useState<Conversation[]>(
    () => loaderData.conversations,
  );
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const syncHistory = async () => {
      setHistoryLoading(true);

      try {
        const latestConversations = await listConversationsClient();
        if (!cancelled) {
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
          setError(syncError instanceof Error ? syncError.message : "Unable to refresh history.");
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    void syncHistory();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleStartConversation = async (prompt: string): Promise<boolean> => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return false;
    }

    setSubmitting(true);
    setError(null);

    try {
      const answer = await startConversationClient({
        prompt: normalizedPrompt,
      });
      setConversations((current) => upsertConversationHistory(current, answer.conversation));
      await navigate({
        to: "/chat/$conversationId",
        params: {
          conversationId: answer.conversation.id,
        },
      });
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
          : "Unable to start a conversation.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAll = async () => {
    try {
      await deleteAllConversationsClient();
      setConversations([]);
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

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await deleteConversationClient(conversationId);
      setConversations((current) => current.filter((item) => item.id !== conversationId));
      setError(null);
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

  const handleSignOut = async () => {
    try {
      await signOutClient();
    } finally {
      await navigate({
        to: "/login",
      });
    }
  };

  return (
    <ChatPage
      composerDraftKey="new"
      composerPlaceholder="Ask about campus services, policies, or handbook rules..."
      conversations={conversations}
      error={error}
      headerDescription="TanStack Start host · same-site answer seam"
      headerTitle="New chat"
      historyLoading={historyLoading}
      messages={[]}
      mode="empty"
      onDeleteAll={handleDeleteAll}
      onDeleteConversation={handleDeleteConversation}
      onNewChat={() => {
        setError(null);
      }}
      onSendPrompt={handleStartConversation}
      onSignOut={handleSignOut}
      submitting={submitting}
      user={loaderData.user}
    />
  );
}
