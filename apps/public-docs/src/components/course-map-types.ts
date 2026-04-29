export type CourseMapRouteGroup = "foundation" | "core" | "extension" | "practice";

export interface CourseMapNode {
	node_id: string;
	node_label: string;
	stage_id: string;
	stage_label: string;
	category_label: string;
	route_group?: CourseMapRouteGroup;
	incoming_count?: number;
	outgoing_count?: number;
}

export interface CourseMapEdge {
	edge_id: string;
	source_node_id: string;
	source_label: string;
	target_node_id: string;
	target_label: string;
}

export type CourseMapStatus = "ready" | "partial" | "failed";
export type CourseMapTitleConfidence = "visible" | "partial" | "absent";

export interface CourseMapBlock {
	blockId: string;
	title: string;
	status: CourseMapStatus;
	titleConfidence: CourseMapTitleConfidence;
	pageNumber: number;
	rowId: string;
	mapIndex: number;
	parentHeadingHint: string;
	displayStageLabels: string[];
	extractionNotes: string[];
	imageSrc: string;
	nodes: CourseMapNode[];
	edges: CourseMapEdge[];
}

export interface CourseMapDocumentData {
	generatedAt: string;
	documentTitle: string;
	documentId: string;
	rawAssetId: string;
	rawVersionId: string;
	blocks: CourseMapBlock[];
}
