import { randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
  DRAFT_CONVERSATION_TITLE,
  toConversationResponse,
  toConversationSummaryResponse,
  toVendorChatHistoryItemResponse,
  type ChatConversationResponse,
  type ChatConversationSummaryResponse,
  type VendorChatHistoryPageResponse,
} from "./model";
import type { ChatConversationStore } from "./store";

export interface ChatConversationService {
  list(input: {
    principal: ResolvedAppPrincipal;
  }): Promise<{ conversations: ChatConversationSummaryResponse[] }>;
  listHistoryPage(input: {
    principal: ResolvedAppPrincipal;
    limit: number;
    endingBeforeConversationId: string | null;
  }): Promise<VendorChatHistoryPageResponse>;
  createDraft(input: {
    principal: ResolvedAppPrincipal;
  }): Promise<{ conversation: ChatConversationResponse }>;
  deleteAll(input: {
    principal: ResolvedAppPrincipal;
  }): Promise<{ deletedCount: number }>;
  deleteById(input: {
    conversationId: string;
    principal: ResolvedAppPrincipal;
  }): Promise<{ deleted: true }>;
  getById(input: {
    conversationId: string;
    principal: ResolvedAppPrincipal;
  }): Promise<{ conversation: ChatConversationResponse }>;
}

export interface ChatConversationServiceDependencies {
  generateId?: (prefix: string) => string;
  now?: () => Date;
  store: ChatConversationStore;
}

function defaultGenerateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function createChatRouteError(input: {
  code: string;
  message: string;
  status: number;
}): AppApiRouteError {
  return new AppApiRouteError({
    code: input.code,
    message: input.message,
    retryable: false,
    status: input.status,
  });
}

function assertChatPrincipal(principal: ResolvedAppPrincipal): string {
  if (!principal.permissions.chat) {
    throw createChatRouteError({
      code: "forbidden",
      message: "Chat access is not available for this principal.",
      status: 403,
    });
  }

  return principal.principal.principalId;
}

export function buildChatConversationService(
  dependencies: ChatConversationServiceDependencies,
): ChatConversationService {
  const generateId = dependencies.generateId ?? defaultGenerateId;
  const now = dependencies.now ?? (() => new Date());

  return {
    async list(input) {
      const ownerUserId = assertChatPrincipal(input.principal);
      const conversations = await dependencies.store.listConversationSummariesByOwner(ownerUserId);

      return {
        conversations: conversations.map(toConversationSummaryResponse),
      };
    },

    async listHistoryPage(input) {
      const ownerUserId = assertChatPrincipal(input.principal);
      const page = await dependencies.store.listConversationSummariesPageByOwner({
        endingBeforeConversationId: input.endingBeforeConversationId,
        limit: input.limit,
        ownerUserId,
      });

      return {
        chats: page.conversations.map(toVendorChatHistoryItemResponse),
        hasMore: page.hasMore,
      };
    },

    async createDraft(input) {
      const ownerUserId = assertChatPrincipal(input.principal);
      const createdAt = now().toISOString();
      const conversation = await dependencies.store.createConversationDraft({
        conversationId: generateId("conv"),
        createdAt,
        ownerUserId,
        title: DRAFT_CONVERSATION_TITLE,
        updatedAt: createdAt,
      });

      return {
        conversation: toConversationResponse(conversation),
      };
    },

    async deleteAll(input) {
      const ownerUserId = assertChatPrincipal(input.principal);
      const deletedCount = await dependencies.store.deleteConversationsByOwner(ownerUserId);

      return { deletedCount };
    },

    async deleteById(input) {
      const ownerUserId = assertChatPrincipal(input.principal);
      const deleted = await dependencies.store.deleteConversationByOwner(
        ownerUserId,
        input.conversationId,
      );
      if (!deleted) {
        throw createChatRouteError({
          code: "conversation_not_found",
          message: "Conversation not found.",
          status: 404,
        });
      }

      return { deleted: true as const };
    },

    async getById(input) {
      const ownerUserId = assertChatPrincipal(input.principal);
      const conversation = await dependencies.store.getConversationDetailByOwner(
        ownerUserId,
        input.conversationId,
      );
      if (!conversation) {
        throw createChatRouteError({
          code: "conversation_not_found",
          message: "Conversation not found.",
          status: 404,
        });
      }

      return {
        conversation: toConversationResponse(conversation),
      };
    },
  };
}
