import type { Node as ProsemirrorNode, Schema } from "prosemirror-model";

// @ts-expect-error donor runtime stays in vendor JS; the compat seam owns the typed boundary.
import { diffEditor as diffEditorRuntime } from "../../../../../vendor/vercel-ai-chatbot/lib/editor/diff.js";

// @ts-expect-error donor runtime stays in vendor JS; the compat seam owns the typed boundary.
export { DiffType } from "../../../../../vendor/vercel-ai-chatbot/lib/editor/diff.js";

export const diffEditor: (
	schema: Schema,
	oldDoc: Record<string, unknown>,
	newDoc: Record<string, unknown>,
) => ProsemirrorNode = diffEditorRuntime;
