import { describe, expect, it } from "vitest";
import codeArtifactSource from "../vendor/vercel-ai-chatbot/artifacts/code/client.tsx?raw";
import imageArtifactSource from "../vendor/vercel-ai-chatbot/artifacts/image/client.tsx?raw";
import sheetArtifactSource from "../vendor/vercel-ai-chatbot/artifacts/sheet/client.tsx?raw";
import textArtifactSource from "../vendor/vercel-ai-chatbot/artifacts/text/client.tsx?raw";
import vendorCodeBlockSource from "../vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx?raw";
import vendorMessageSource from "../vendor/vercel-ai-chatbot/components/ai-elements/message.tsx?raw";
import vendorReasoningSource from "../vendor/vercel-ai-chatbot/components/ai-elements/reasoning.tsx?raw";
import chatArtifactSource from "../vendor/vercel-ai-chatbot/components/chat/artifact.tsx?raw";
import vendorTextEditorSource from "../vendor/vercel-ai-chatbot/components/chat/text-editor.tsx?raw";

describe("chat code splitting", () => {
	it("keeps markdown highlighting on the donor streamdown/code specifier", () => {
		expect(vendorMessageSource).toContain("@streamdown/code");
		expect(vendorMessageSource).not.toContain("@platform/chat/streamdown-code-plugin");
		expect(vendorReasoningSource).toContain("@streamdown/code");
		expect(vendorReasoningSource).not.toContain("@platform/chat/streamdown-code-plugin");
	});

	it("keeps donor code blocks on the shiki entrypoint while runtime ownership moves behind compat seams", () => {
		expect(vendorCodeBlockSource).toContain('import { createHighlighter } from "shiki";');
		expect(vendorCodeBlockSource).not.toContain("@platform/chat/shiki-runtime");
	});

	it("keeps the text editor on the donor direct import path instead of a repo-local runtime loader", () => {
		expect(vendorTextEditorSource).toContain(
			'import { exampleSetup } from "prosemirror-example-setup";',
		);
		expect(vendorTextEditorSource).toContain(
			'import { inputRules } from "prosemirror-inputrules";',
		);
		expect(vendorTextEditorSource).toContain('import { EditorState } from "prosemirror-state";');
		expect(vendorTextEditorSource).toContain(
			'import { type Decoration, DecorationSet, EditorView } from "prosemirror-view";',
		);
		expect(vendorTextEditorSource).not.toContain("Promise.all([");
		expect(vendorTextEditorSource).not.toContain("loadTextEditorRuntime");
		expect(vendorTextEditorSource).not.toContain("textEditorRuntimePromise");
	});

	it("keeps artifact registration light and lazy-loads heavy editors", () => {
		expect(chatArtifactSource).toContain("LazyTextArtifactContent");
		expect(chatArtifactSource).toContain("LazyCodeArtifactContent");
		expect(chatArtifactSource).toContain("LazySheetArtifactContent");
		expect(chatArtifactSource).not.toContain("@/components/chat/text-editor");
		expect(chatArtifactSource).not.toContain("@/components/chat/code-editor");
		expect(chatArtifactSource).not.toContain("@/components/chat/sheet-editor");

		expect(textArtifactSource).not.toContain("@/components/chat/text-editor");
		expect(codeArtifactSource).not.toContain("@/components/chat/code-editor");
		expect(sheetArtifactSource).not.toContain("@/components/chat/sheet-editor");
		expect(imageArtifactSource).not.toContain("@/components/chat/image-editor");
	});
});
