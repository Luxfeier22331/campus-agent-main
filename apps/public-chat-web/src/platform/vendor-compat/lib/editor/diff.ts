import type { Node as ProsemirrorNode, Schema } from "prosemirror-model";

// @ts-ignore donor runtime stays in vendor JS; the compat seam owns the typed boundary.
import { DiffType, diffEditor as diffEditorRuntime } from "../../../../../vendor/vercel-ai-chatbot/lib/editor/diff.js";

export { DiffType };

export const diffEditor: (
  schema: Schema,
  oldDoc: Record<string, unknown>,
  newDoc: Record<string, unknown>,
) => ProsemirrorNode = diffEditorRuntime;
