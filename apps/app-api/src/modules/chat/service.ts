import { randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
  DRAFT_CONVERSATION_TITLE,
  toConversationResponse,
  toConversationSummaryResponse,
  type ChatConversationResponse,
  type ChatConversationSummaryResponse,
} from "./model";
import type { ChatConversationStore } from "./store";

export interface ChatConversationService {
  list(input: {
    principal: ResolvedAppPrincipal;
  }): Promise<{ conversations: ChatConversationSummaryResponse[] }>;
  createDraft(input: {
    principal: ResolvedAppPrincipal;
  }): Promise<{ conversation: ChatConversationResponse }>;
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
