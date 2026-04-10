import type { Node as ProsemirrorNode, Schema } from "prosemirror-model";

export const DiffType: {
  readonly Deleted: -1;
  readonly Inserted: 1;
  readonly Unchanged: 0;
};

export function diffEditor(
  schema: Schema,
  oldDoc: Record<string, unknown>,
  newDoc: Record<string, unknown>,
): ProsemirrorNode;
