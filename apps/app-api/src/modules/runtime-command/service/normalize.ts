import { createHash, createHmac, randomUUID } from "node:crypto";

import type { ResolvedAppPrincipal } from "../../auth";
import type { RequestedScope, SupervisorExecutionResponse } from "../../integration";
import type { ChatMessageStructuredPart, ChatPlaceCard } from "../../chat";
import type { ChatCommandPayload, ValidatedChatCommandPayload } from "./types";
import { createPreAcceptError } from "./errors";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function defaultGenerateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function defaultComputeFingerprint(input: {
  conversationDiscriminator: string;
  prompt: string;
  requestedCapability: string;
  requestedScope: RequestedScope | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        conversationDiscriminator: input.conversationDiscriminator,
        prompt: input.prompt,
        requestedCapability: input.requestedCapability,
        requestedScope: input.requestedScope,
      }),
    )
    .digest("hex");
}

export function previewText(text: string, maxLength = 160): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function normalizeRequestedScope(value: unknown): RequestedScope | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const scope = value as Record<string, unknown>;
  const corpus = normalizeString(scope.corpus);
  const collection = normalizeString(scope.collection);
  if (!corpus || !collection) {
    return null;
  }

  return { corpus, collection };
}

function normalizeRequestedCapability(value: unknown): string | null {
  const capability = normalizeString(value);
  return capability || null;
}

function resolveSafetyIdentifierSource(principal: ResolvedAppPrincipal): string | null {
  const principalId = normalizeString(principal.principal.principalId);
  if (principalId) {
    return `principal:${principalId}`;
  }

  const sessionId = normalizeString(principal.session?.sessionId);
  if (sessionId) {
    return `session:${sessionId}`;
  }

  return null;
}

export function deriveSafetyIdentifier(
  principal: ResolvedAppPrincipal,
  secret: string,
): string | null {
  const source = resolveSafetyIdentifierSource(principal);
  const normalizedSecret = normalizeString(secret);
  if (!source || !normalizedSecret) {
    return null;
  }

  return createHmac("sha256", normalizedSecret).update(source).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => item !== null);
}

function normalizePointGeometry(value: unknown): ChatPlaceCard["pointGeometry"] {
  if (!isRecord(value)) {
    return null;
  }

  const longitude = typeof value.longitude === "number" ? value.longitude : null;
  const latitude = typeof value.latitude === "number" ? value.latitude : null;
  if (longitude === null || latitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function normalizePlaceRef(value: unknown): Pick<
  ChatPlaceCard,
  "campusArea" | "campusScope" | "displayName" | "entityType" | "placeId"
> | null {
  if (!isRecord(value)) {
    return null;
  }

  const placeId = normalizeOptionalString(value.place_id);
  const entityType = normalizeOptionalString(value.entity_type);
  const displayName = normalizeOptionalString(value.display_name);
  if (!placeId || !entityType || !displayName) {
    return null;
  }

  return {
    placeId,
    entityType,
    displayName,
    campusScope: normalizeOptionalString(value.campus_scope),
    campusArea: normalizeOptionalString(value.campus_area),
  };
}

export function normalizePlaceCardPart(input: {
  selectedTarget: string | null;
  status: SupervisorExecutionResponse["status"];
  result: unknown;
}): ChatMessageStructuredPart[] {
  if (input.selectedTarget !== "navigation-specialist" || input.status !== "completed") {
    return [];
  }

  if (!isRecord(input.result)) {
    return [];
  }

  const placeCard = isRecord(input.result.place_card) ? input.result.place_card : null;
  if (!placeCard) {
    return [];
  }

  const place = normalizePlaceRef(placeCard.place);
  if (!place) {
    return [];
  }

  return [
    {
      type: "place_card",
      placeCard: {
        ...place,
        locationDescription: normalizeOptionalString(
          placeCard.location_description ?? placeCard.address,
        ),
        landmarkHint: normalizeOptionalString(placeCard.landmark_hint),
        accessNote: normalizeOptionalString(placeCard.access_note ?? placeCard.directions),
        openingNote: normalizeOptionalString(placeCard.opening_note ?? placeCard.hours),
        serviceTags: normalizeStringArray(placeCard.service_tags ?? placeCard.tags),
        pointGeometry: normalizePointGeometry(placeCard.point_geometry),
        coordinateReferenceSystem: normalizeOptionalString(
          placeCard.coordinate_reference_system,
        ),
        sourceRefs: normalizeStringArray(placeCard.source_refs),
      },
    },
  ];
}

export function extractSourceDocIds(result: unknown): string[] {
  if (!isRecord(result)) {
    return [];
  }

  const sources = Array.isArray(result.sources)
    ? result.sources
    : isRecord(result.evidence) && Array.isArray(result.evidence.sources)
      ? result.evidence.sources
      : [];
  if (sources.length === 0) {
    return [];
  }

  const sourceDocIds = sources
    .map((source) =>
      isRecord(source)
        ? normalizeOptionalString(
            source.source_document_id ?? source.sourceDocumentId ?? source.doc_id,
          )
        : null,
    )
    .filter((sourceDocumentId): sourceDocumentId is string => Boolean(sourceDocumentId));

  return Array.from(new Set(sourceDocIds));
}

export function resolveValidatedPayload(
  payload: ChatCommandPayload,
): ValidatedChatCommandPayload {
  const conversationId = normalizeString(payload.conversationId) || null;

  const prompt = normalizeString(payload.prompt);
  if (!prompt) {
    throw createPreAcceptError({
      code: "validation_failed",
      details: { field: "prompt" },
      message: "prompt is required.",
      status: 422,
    });
  }

  const requestedCapability = normalizeRequestedCapability(payload.requestedCapability) ?? "knowledge";
  if (requestedCapability !== "knowledge") {
    throw createPreAcceptError({
      code: "validation_failed",
      details: { field: "requestedCapability" },
      message: "Only knowledge requests are accepted on this route.",
      status: 422,
    });
  }

  const requestedScope = normalizeRequestedScope(payload.requestedScope);

  return {
    conversationId,
    prompt,
    requestedCapability,
    requestedScope,
  };
}
