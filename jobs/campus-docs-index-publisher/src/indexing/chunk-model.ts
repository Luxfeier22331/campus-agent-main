export interface ChunkPiece {
	content: string;
	mergeBlockedBefore?: boolean;
	rootUnitIds: string[];
}

export interface ChunkLimits {
	maxChars: number;
	targetChars: number;
}

export interface TableContext extends ChunkPiece {
	fullyCopiedRootUnitIds: string[];
}

export type SplittableTextKind = "blockquote" | "list" | "paragraph" | "table";

export interface LogicalTableCell {
	columnSpan: number;
	header: boolean;
	id: number;
	originColumn: number;
	originRow: number;
	rowSpan: number;
	text: string;
}

export interface LogicalTableValue {
	columns: number[];
	text: string;
}
