// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createAxiomRuntimeEventSink,
  sanitizeAxiomEventPayload,
} from "../src/modules/telemetry/axiom";

describe("axiom runtime event sink", () => {
  it("drops forbidden sensitive fields before building the ingest payload", () => {
    expect(
      sanitizeAxiomEventPayload({
        event_type: "request.accepted",
        request_id: "req_01HQ",
        trace_id: "trace_01HQ",
        surface: "public_chat_web",
        status: "accepted",
        prompt: "图书馆开放到几点？",
        answer: "图书馆开放到 22:00。",
        cookie: "better-auth.session_token=test",
        operator_email: "ops@example.com",
        transcript: "user: ...",
      }),
    ).toEqual({
      event_type: "request.accepted",
      request_id: "req_01HQ",
      status: "accepted",
      surface: "public_chat_web",
      trace_id: "trace_01HQ",
    });
  });

  it("no-ops when the Axiom runtime config is incomplete", async () => {
    const fetchImplementation = vi.fn();
    const sink = createAxiomRuntimeEventSink(
      {},
      {
        fetchImplementation,
      },
    );

    await sink.emit({
      event_type: "request.accepted",
      request_id: "req_01HQ",
      status: "accepted",
      surface: "public_chat_web",
      trace_id: "trace_01HQ",
    });

    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("posts structured events to the dataset ingest endpoint when using the shared Axiom API domain", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const sink = createAxiomRuntimeEventSink(
      {
        AXIOM_DATASET: "campus_agent_runtime",
        AXIOM_ENDPOINT: "https://api.axiom.co",
        AXIOM_TOKEN: "axiom-secret",
      },
      {
        fetchImplementation,
      },
    );

    await sink.emit({
      event_type: "request.finalized",
      request_id: "req_01HQ",
      requested_scope_summary: "regulations/student_handbook",
      status: "completed",
      surface: "public_chat_web",
      trace_id: "trace_01HQ",
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.axiom.co/v1/datasets/campus_agent_runtime/ingest",
      expect.objectContaining({
        body: JSON.stringify([
          {
            event_type: "request.finalized",
            request_id: "req_01HQ",
            requested_scope_summary: "regulations/student_handbook",
            status: "completed",
            surface: "public_chat_web",
            trace_id: "trace_01HQ",
          },
        ]),
        headers: {
          Authorization: "Bearer axiom-secret",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });

  it("posts structured events to the edge ingest endpoint when using an edge deployment domain", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const sink = createAxiomRuntimeEventSink(
      {
        AXIOM_DATASET: "campus_agent_runtime",
        AXIOM_ENDPOINT: "https://us-east-1.aws.edge.axiom.co",
        AXIOM_TOKEN: "axiom-secret",
      },
      {
        fetchImplementation,
      },
    );

    await sink.emit({
      event_type: "request.finalized",
      request_id: "req_01HQ",
      requested_scope_summary: "regulations/student_handbook",
      status: "completed",
      surface: "public_chat_web",
      trace_id: "trace_01HQ",
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://us-east-1.aws.edge.axiom.co/v1/ingest/campus_agent_runtime",
      expect.objectContaining({
        body: JSON.stringify([
          {
            event_type: "request.finalized",
            request_id: "req_01HQ",
            requested_scope_summary: "regulations/student_handbook",
            status: "completed",
            surface: "public_chat_web",
            trace_id: "trace_01HQ",
          },
        ]),
        headers: {
          Authorization: "Bearer axiom-secret",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
  });
});
