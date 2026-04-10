import { describe, expect, it } from "vitest";

import vendorCodeBlockSource from "../vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx?raw";
import vendorMessageSource from "../vendor/vercel-ai-chatbot/components/ai-elements/message.tsx?raw";
import vendorReasoningSource from "../vendor/vercel-ai-chatbot/components/ai-elements/reasoning.tsx?raw";
import vendorTextEditorSource from "../vendor/vercel-ai-chatbot/components/chat/text-editor.tsx?raw";

describe("chat code splitting", () => {
  it("routes markdown highlighting through a platform-owned streamdown code plugin", () => {
    expect(vendorMessageSource).toContain("@platform/chat/streamdown-code-plugin");
    expect(vendorMessageSource).not.toContain('@streamdown/code');
    expect(vendorReasoningSource).toContain(
      "@platform/chat/streamdown-code-plugin",
    );
    expect(vendorReasoningSource).not.toContain('@streamdown/code');
  });

  it("keeps donor code blocks off the full shiki bundle entrypoint", () => {
    expect(vendorCodeBlockSource).toContain("@platform/chat/shiki-runtime");
    expect(vendorCodeBlockSource).not.toContain(
      'import { createHighlighter } from "shiki"',
    );
  });

  it("keeps the text editor on the donor direct import path instead of a repo-local runtime loader", () => {
    expect(vendorTextEditorSource).toContain(
      'import { exampleSetup } from "prosemirror-example-setup";',
    );
    expect(vendorTextEditorSource).toContain(
      'import { inputRules } from "prosemirror-inputrules";',
    );
    expect(vendorTextEditorSource).toContain(
      'import { EditorState } from "prosemirror-state";',
    );
    expect(vendorTextEditorSource).toContain(
      'import { type Decoration, DecorationSet, EditorView } from "prosemirror-view";',
    );
    expect(vendorTextEditorSource).not.toContain("Promise.all([");
    expect(vendorTextEditorSource).not.toContain("loadTextEditorRuntime");
    expect(vendorTextEditorSource).not.toContain("textEditorRuntimePromise");
  });
});
