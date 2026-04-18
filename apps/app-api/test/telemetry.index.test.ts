// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  getTraceData: vi.fn(() => ({
    baggage: "test-baggage",
    "sentry-trace": "test-trace",
  })),
  setContext: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn((callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
    callback({
      setTag: vi.fn(),
    })),
}));

vi.mock("@sentry/cloudflare", () => sentryMocks);

import { createAppTelemetry } from "../src/modules/telemetry";

describe("app telemetry", () => {
  beforeEach(() => {
    sentryMocks.captureException.mockReset();
    sentryMocks.getTraceData.mockReset();
    sentryMocks.getTraceData.mockReturnValue({
      baggage: "test-baggage",
      "sentry-trace": "test-trace",
    });
    sentryMocks.setContext.mockReset();
    sentryMocks.setTag.mockReset();
    sentryMocks.withScope.mockReset();
    sentryMocks.withScope.mockImplementation(
      (callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
        callback({
          setTag: vi.fn(),
        }),
    );
  });

  it("fails open when configureChatRequestScope hits a sentry error", () => {
    sentryMocks.setTag.mockImplementation(() => {
      throw new Error("sentry setTag failed");
    });

    const telemetry = createAppTelemetry({}, { axiomSink: { emit: vi.fn() } });

    expect(() =>
      telemetry.configureChatRequestScope({
        actor: {
          principalType: "campus_member",
          subject: "user_01",
        },
        conversationId: "conv_01",
        requestId: "req_01",
        requestedCapability: "knowledge",
        requestedScope: {
          collection: "student_handbook",
          corpus: "regulations",
        },
        surface: "public_chat_web",
        traceId: "trace_01",
      }),
    ).not.toThrow();
  });

  it("fails open when sentry trace data lookup throws", () => {
    sentryMocks.getTraceData.mockImplementation(() => {
      throw new Error("trace data failed");
    });

    const telemetry = createAppTelemetry({}, { axiomSink: { emit: vi.fn() } });

    expect(telemetry.getTraceHeaders()).toEqual({
      baggage: null,
      sentryTrace: null,
    });
  });

  it("projects canonical safety identifier into sentry tags and runtime telemetry payloads", async () => {
    const axiomSink = { emit: vi.fn().mockResolvedValue(undefined) };
    const telemetry = createAppTelemetry({}, { axiomSink });
    const safetyIdentifier =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    telemetry.configureChatRequestScope({
      actor: {
        principalType: "campus_member",
        subject: "user_01",
      },
      conversationId: "conv_01",
      requestId: "req_01",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      safetyIdentifier,
      surface: "public_chat_web",
      traceId: "trace_01",
    });

    await telemetry.recordRequestAccepted({
      actor: {
        principalType: "campus_member",
        subject: "user_01",
      },
      conversationId: "conv_01",
      requestId: "req_01",
      requestedCapability: "knowledge",
      requestedScope: {
        collection: "student_handbook",
        corpus: "regulations",
      },
      safetyIdentifier,
      status: "accepted",
      surface: "public_chat_web",
      traceId: "trace_01",
    });

    expect(sentryMocks.setTag).toHaveBeenCalledWith("safety_identifier", safetyIdentifier);
    expect(axiomSink.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "request.accepted",
        request_id: "req_01",
        safety_identifier: safetyIdentifier,
      }),
    );
  });
});
