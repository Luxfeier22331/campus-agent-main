import { describe, expect, it } from "vitest";

import dataStreamHandlerSource from "../vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx?raw";
import documentPreviewSource from "../vendor/vercel-ai-chatbot/components/chat/document-preview.tsx?raw";
import shellSource from "../vendor/vercel-ai-chatbot/components/chat/shell.tsx?raw";
import textEditorSource from "../vendor/vercel-ai-chatbot/components/chat/text-editor.tsx?raw";

describe("public chat artifact runtime parity", () => {
  it("keeps the donor shell on direct artifact ownership", () => {
    expect(shellSource).toContain('import { Artifact } from "./artifact"');
    expect(shellSource).not.toContain("ArtifactPanel");
    expect(shellSource).not.toContain("ArtifactPlaceholder");
    expect(shellSource).not.toContain("shouldRenderArtifact");
    expect(shellSource).not.toContain("Suspense");
    expect(shellSource).not.toContain('lazy(async () =>');
  });

  it("keeps artifact stream handling on donor artifactDefinitions dispatch", () => {
    expect(dataStreamHandlerSource).toContain('import { artifactDefinitions } from "./artifact"');
    expect(dataStreamHandlerSource).toContain("artifactDefinition?.onStreamPart");
    expect(dataStreamHandlerSource).not.toContain("applyArtifactStreamPart");
    expect(dataStreamHandlerSource).not.toContain("normalizeSuggestion");
  });

  it("keeps inline document preview on donor direct editor imports", () => {
    expect(documentPreviewSource).toContain('import { CodeEditor } from "./code-editor"');
    expect(documentPreviewSource).toContain('import { ImageEditor } from "./image-editor"');
    expect(documentPreviewSource).toContain('import { SpreadsheetEditor } from "./sheet-editor"');
    expect(documentPreviewSource).toContain('import { Editor } from "./text-editor"');
    expect(documentPreviewSource).not.toContain("LazyCodeEditor");
    expect(documentPreviewSource).not.toContain("LazyImageEditor");
    expect(documentPreviewSource).not.toContain("LazySpreadsheetEditor");
    expect(documentPreviewSource).not.toContain("LazyTextEditor");
    expect(documentPreviewSource).not.toContain("<Suspense");
  });

  it("keeps the text editor on donor static runtime imports", () => {
    expect(textEditorSource).toContain(
      'import { exampleSetup } from "prosemirror-example-setup"',
    );
    expect(textEditorSource).toContain(
      'import { inputRules } from "prosemirror-inputrules"',
    );
    expect(textEditorSource).toContain(
      'import { EditorState } from "prosemirror-state"',
    );
    expect(textEditorSource).toContain(
      'import { type Decoration, DecorationSet, EditorView } from "prosemirror-view"',
    );
    expect(textEditorSource).not.toContain("loadTextEditorRuntime");
    expect(textEditorSource).not.toContain("Promise.all([");
    expect(textEditorSource).not.toContain("textEditorRuntimePromise");
    expect(textEditorSource).not.toContain("runtime.");
  });
});
