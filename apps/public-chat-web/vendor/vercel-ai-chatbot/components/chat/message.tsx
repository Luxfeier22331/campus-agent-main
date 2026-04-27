"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { Vote } from "@/lib/db/schema";
import type {
  ChatMessage,
  ChatMessagePart,
  PlaceCardData,
  SourceCardData,
} from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

function entityTypeLabel(entityType: PlaceCardData["entityType"]): string {
  switch (entityType) {
    case "building":
      return "楼宇";
    case "service_point":
      return "服务点";
    case "office":
      return "办事点";
    case "gate":
      return "校门";
    case "stop":
      return "站点";
  }
}

function formatCoordinate(value: number): string {
  return value.toFixed(5);
}

function getPointCoordinates(card: PlaceCardData): { latitude: string; longitude: string } | null {
  const coordinates = card.pointGeometry?.coordinates;

  if (
    card.pointGeometry?.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) {
    return null;
  }

  const [longitude, latitude] = coordinates;
  return {
    latitude: formatCoordinate(latitude),
    longitude: formatCoordinate(longitude),
  };
}

function PlaceCardBlock({
  part,
}: {
  part: Extract<ChatMessagePart, { type: "data-place-card" }>;
}) {
  const card = part.data;
  const coordinates = getPointCoordinates(card);

  return (
    <div
      className="w-full max-w-[min(100%,32rem)] overflow-hidden rounded-[1.25rem] border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-teal-50 shadow-[0_18px_45px_-28px_rgba(6,95,70,0.45)]"
      data-testid="place-card"
    >
      <div className="flex items-start justify-between gap-3 border-b border-emerald-200/70 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-slate-900">{card.displayName}</div>
          <div className="mt-1 text-[12px] text-slate-600">
            {card.campusScope
              ? `${card.campusScope}${card.campusArea ? ` · ${card.campusArea}` : ""}`
              : card.campusArea
                ? `区域：${card.campusArea}`
                : "校内地点"}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white">
          {entityTypeLabel(card.entityType)}
        </span>
      </div>
      <div className="space-y-3 px-4 py-3 text-[13px] leading-[1.65] text-slate-700">
        <div className="grid gap-2 rounded-2xl border border-emerald-200/80 bg-white/80 p-3">
          {card.campusScope ? (
            <div className="flex items-start gap-2">
              <span className="shrink-0 font-semibold text-slate-900">校区范围</span>
              <span className="text-slate-700">{card.campusScope}</span>
            </div>
          ) : null}
          {card.campusArea ? (
            <div className="flex items-start gap-2">
              <span className="shrink-0 font-semibold text-slate-900">区域</span>
              <span className="text-slate-700">{card.campusArea}</span>
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            <span className="shrink-0 font-semibold text-slate-900">地点编码</span>
            <span className="break-all font-mono text-[12px] text-slate-600">{card.placeId}</span>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-emerald-800">
            位置说明
          </div>
          <div>{card.locationDescription}</div>
        </div>
        {card.landmarkHint ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-emerald-800">
              地标提示
            </div>
            <div>{card.landmarkHint}</div>
          </div>
        ) : null}
        {card.accessNote ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-emerald-800">
              通行提示
            </div>
            <div>{card.accessNote}</div>
          </div>
        ) : null}
        {card.openingNote ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-emerald-800">
              开放说明
            </div>
            <div>{card.openingNote}</div>
          </div>
        ) : null}
        {card.serviceTags?.length ? (
          <div className="flex flex-wrap gap-2">
            {card.serviceTags.map((tag) => (
              <span
                className="rounded-full border border-emerald-200 bg-emerald-100/70 px-2.5 py-1 text-[11px] font-medium text-emerald-900"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {coordinates ? (
          <div className="rounded-xl bg-slate-900 px-3 py-2 text-[12px] text-slate-100">
            坐标：纬度 {coordinates.latitude}，经度 {coordinates.longitude}
            {card.coordinateReferenceSystem ? ` · ${card.coordinateReferenceSystem}` : ""}
          </div>
        ) : null}
        {card.sourceRefs?.length ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-emerald-800">
              信息来源
            </div>
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-slate-600">
              {card.sourceRefs.map((sourceRef) => (
                <li key={sourceRef}>{sourceRef}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SourceCardMeta({ card }: { card: SourceCardData }) {
  const metaItems = [
    card.collectionLabel,
    card.versionLabel,
    card.pageLabel,
  ].filter(Boolean);

  if (metaItems.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      {metaItems.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function SourceCardsBlock({
  part,
}: {
  part: Extract<ChatMessagePart, { type: "data-source-cards" }>;
}) {
  const cards = part.data;
  if (!cards.length) {
    return null;
  }

  return (
    <section
      aria-label="参考来源"
      className="w-full max-w-[min(100%,40rem)] rounded-2xl border border-border/70 bg-background/80 p-3 shadow-[var(--shadow-card)]"
      data-testid="source-cards"
    >
      <div className="mb-2 text-[12px] font-medium text-muted-foreground">参考来源</div>
      <div className="grid gap-2">
        {cards.map((card) => (
          <a
            className="group block rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={card.href}
            key={card.href}
          >
            <SourceCardMeta card={card} />
            <div className="mt-1 font-medium text-[13px] text-foreground leading-[1.45]">
              {card.title}
            </div>
            {card.sectionTitle ? (
              <div className="mt-1 text-[12px] text-muted-foreground">
                {card.sectionTitle}
              </div>
            ) : null}
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.55] text-muted-foreground">
              {card.snippet}
            </p>
            <div className="mt-2 text-[12px] font-medium text-foreground/75 group-hover:text-foreground">
              查看原文
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onEdit?: (message: ChatMessage) => void;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex flex-row justify-end gap-2"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            name: attachment.filename ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };

  const parts = message.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    if (type === "text") {
      return (
        <MessageContent
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
        </MessageContent>
      );
    }

    if (type === "data-place-card") {
      return <PlaceCardBlock key={key} part={part} />;
    }

    if (type === "data-source-cards") {
      return <SourceCardsBlock key={key} part={part} />;
    }

    if (type === "tool-getWeather") {
      const { toolCallId, state } = part;
      const approvalId = (part as { approval?: { id: string } }).approval?.id;
      const isDenied =
        state === "output-denied" ||
        (state === "approval-responded" &&
          (part as { approval?: { approved?: boolean } }).approval?.approved ===
            false);
      const widthClass = "w-[min(100%,450px)]";

      if (state === "output-available") {
        return (
          <div className={widthClass} key={toolCallId}>
            <Weather weatherAtLocation={part.output} />
          </div>
        );
      }

      if (isDenied) {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state="output-denied" type="tool-getWeather" />
              <ToolContent>
                <div className="px-4 py-3 text-muted-foreground text-sm">
                  Weather lookup was denied.
                </div>
              </ToolContent>
            </Tool>
          </div>
        );
      }

      if (state === "approval-responded") {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state={state} type="tool-getWeather" />
              <ToolContent>
                <ToolInput input={part.input} />
              </ToolContent>
            </Tool>
          </div>
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <Tool className="w-full" defaultOpen={true}>
            <ToolHeader state={state} type="tool-getWeather" />
            <ToolContent>
              {(state === "input-available" ||
                state === "approval-requested") && (
                <ToolInput input={part.input} />
              )}
              {state === "approval-requested" && approvalId && (
                <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                  <button
                    className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      addToolApprovalResponse({
                        id: approvalId,
                        approved: false,
                        reason: "User denied weather lookup",
                      });
                    }}
                    type="button"
                  >
                    Deny
                  </button>
                  <button
                    className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                    onClick={() => {
                      addToolApprovalResponse({
                        id: approvalId,
                        approved: true,
                      });
                    }}
                    type="button"
                  >
                    Allow
                  </button>
                </div>
              )}
            </ToolContent>
          </Tool>
        </div>
      );
    }

    if (type === "tool-createDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error creating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <DocumentPreview
          isReadonly={isReadonly}
          key={toolCallId}
          result={part.output}
        />
      );
    }

    if (type === "tool-updateDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error updating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <div className="relative" key={toolCallId}>
          <DocumentPreview
            args={{ ...part.output, isUpdate: true }}
            isReadonly={isReadonly}
            result={part.output}
          />
        </div>
      );
    }

    if (type === "tool-requestSuggestions") {
      const { toolCallId, state } = part;

      return (
        <Tool
          className="w-[min(100%,450px)]"
          defaultOpen={true}
          key={toolCallId}
        >
          <ToolHeader state={state} type="tool-requestSuggestions" />
          <ToolContent>
            {state === "input-available" && <ToolInput input={part.input} />}
            {state === "output-available" && (
              <ToolOutput
                errorText={undefined}
                output={
                  "error" in part.output ? (
                    <div className="rounded border p-2 text-red-500">
                      Error: {String(part.output.error)}
                    </div>
                  ) : (
                    <DocumentToolResult
                      isReadonly={isReadonly}
                      result={part.output}
                      type="request-suggestions"
                    />
                  )
                }
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    return null;
  });

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onEdit={onEdit ? () => onEdit(message) : undefined}
      vote={vote}
    />
  );

  const content = isThinking ? (
    <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
      <Shimmer className="font-medium" duration={1}>
        Thinking...
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
      {actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3"
        )}
      >
        {isAssistant && (
          <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SparklesIcon size={13} />
            </div>
          </div>
        )}
        {isAssistant ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">{content}</div>
        ) : (
          content
        )}
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message w-full"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
            <SparklesIcon size={13} />
          </div>
        </div>

        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
          <Shimmer className="font-medium" duration={1}>
            Thinking...
          </Shimmer>
        </div>
      </div>
    </div>
  );
};
