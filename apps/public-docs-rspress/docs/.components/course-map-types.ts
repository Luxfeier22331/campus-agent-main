export type CourseMapRouteGroup = "foundation" | "core" | "extension" | "practice";

export type CourseMapNode = {
  node_label: string;
  stage_label: string;
  category_label: string;
  route_group?: CourseMapRouteGroup;
  incoming_count?: number;
  outgoing_count?: number;
};

export type CourseMapEdge = {
  source_label: string;
  target_label: string;
};

export type CourseMapData = {
  title: string;
  documentTitle: string;
  documentId: string;
  pageNumber: number;
  rowId: string;
  parentHeadingHint: string;
  displayStageLabels: string[];
  nodes: CourseMapNode[];
  edges: CourseMapEdge[];
  manualReviewNotes: string[];
  reviewedAt: string;
};

export function buildNodeKey(node: Pick<CourseMapNode, "stage_label" | "node_label">): string {
  return `${node.stage_label}::${node.node_label}`;
}
