import { mapAnswerResult } from "../app/lib/chat-types";

describe("answer api mapping", () => {
  it("maps clarification results into clarification ui state", () => {
    expect(
      mapAnswerResult({
        kind: "clarification",
        text: "Which campus are you asking about?",
        request_id: "req-1",
      }),
    ).toEqual({
      kind: "clarification",
      text: "Which campus are you asking about?",
      requestId: "req-1",
    });
  });

  it("maps failures into retryable error state", () => {
    expect(
      mapAnswerResult({
        kind: "error",
        message: "Upstream timeout",
        request_id: "req-2",
      }),
    ).toEqual({
      kind: "error",
      message: "Upstream timeout",
      requestId: "req-2",
      retryable: true,
    });
  });

  it("preserves non-retryable no-answer style failures", () => {
    expect(
      mapAnswerResult({
        kind: "error",
        message: "No grounded answer is available yet.",
        request_id: "trace-3",
        retryable: false,
      }),
    ).toEqual({
      kind: "error",
      message: "No grounded answer is available yet.",
      requestId: "trace-3",
      retryable: false,
    });
  });
});
