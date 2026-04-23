import {
	Background,
	Controls,
	type Edge,
	Handle,
	type Node,
	type NodeProps,
	type NodeTypes,
	Position,
	ReactFlow,
	ReactFlowProvider,
} from "@xyflow/react";
import dagre from "dagre";
import { memo, useMemo } from "react";
import "@xyflow/react/dist/style.css";
import { buildNodeKey, type CourseMapBlock, type CourseMapNode } from "./course-map-types";

type Props = {
	data: CourseMapBlock;
	activeNodeKey: string | null;
	onSelectNode: (nodeKey: string) => void;
};

type GraphNodeData = {
	label: string;
	stage: string;
	groupLabel: string;
	related: boolean;
};

const NODE_WIDTH = 196;
const NODE_HEIGHT = 84;

const ROUTE_GROUP_LABELS = {
	foundation: "公共基础",
	core: "专业核心",
	extension: "拓展与个性化",
	practice: "实践环节",
} as const;

const ROUTE_GROUP_ORDER = ["foundation", "core", "extension", "practice"] as const;

function resolveStageLabels(data: CourseMapBlock): string[] {
	return data.displayStageLabels.length > 0
		? data.displayStageLabels
		: Array.from(new Set(data.nodes.map((node) => node.stage_label).filter(Boolean)));
}

function routeGroupSortValue(node: CourseMapNode): number {
	const group = node.route_group ?? "core";
	const index = ROUTE_GROUP_ORDER.indexOf(group);
	return index === -1 ? ROUTE_GROUP_ORDER.indexOf("core") : index;
}

function buildRelatedLabelSet(data: CourseMapBlock, activeLabel: string | null): Set<string> {
	if (!activeLabel) {
		return new Set();
	}
	const labels = new Set<string>();
	for (const edge of data.edges) {
		if (edge.source_label === activeLabel) {
			labels.add(edge.target_label);
		}
		if (edge.target_label === activeLabel) {
			labels.add(edge.source_label);
		}
	}
	return labels;
}

const GraphNodeCard = memo(function GraphNodeCard({
	data,
	selected,
}: NodeProps<Node<GraphNodeData>>) {
	const className = selected
		? "course-map-graph-node-card selected"
		: data.related
			? "course-map-graph-node-card related"
			: "course-map-graph-node-card";

	return (
		<div className={className}>
			<Handle className="course-map-graph-handle" position={Position.Left} type="target" />
			<span className="course-map-graph-node-stage">{data.stage}</span>
			<strong className="course-map-graph-node-title">{data.label}</strong>
			<span className="course-map-graph-node-group">{data.groupLabel}</span>
			<Handle className="course-map-graph-handle" position={Position.Right} type="source" />
		</div>
	);
});

const nodeTypes: NodeTypes = {
	courseMapNode: GraphNodeCard,
};

function buildRelationGraph({
	data,
	activeNodeKey,
}: {
	data: CourseMapBlock;
	activeNodeKey: string | null;
}): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		rankdir: "LR",
		ranksep: 96,
		nodesep: 28,
		marginx: 28,
		marginy: 28,
	});

	const stageLabels = resolveStageLabels(data);
	const sortedNodes = [...data.nodes].sort((left, right) => {
		const leftStageIndex = stageLabels.indexOf(left.stage_label);
		const rightStageIndex = stageLabels.indexOf(right.stage_label);
		if (leftStageIndex !== rightStageIndex) {
			return leftStageIndex - rightStageIndex;
		}
		const groupDiff = routeGroupSortValue(left) - routeGroupSortValue(right);
		if (groupDiff !== 0) {
			return groupDiff;
		}
		return left.node_label.localeCompare(right.node_label, "zh-Hans-CN");
	});

	for (const node of sortedNodes) {
		graph.setNode(buildNodeKey(node), {
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
		});
	}

	const edges: Edge[] = [];
	const activeNode = data.nodes.find((node) => buildNodeKey(node) === activeNodeKey) ?? null;
	const activeLabel = activeNode?.node_label ?? null;
	const relatedLabels = buildRelatedLabelSet(data, activeLabel);
	for (const [index, edge] of data.edges.entries()) {
		const sourceNode = data.nodes.find((node) => node.node_label === edge.source_label);
		const targetNode = data.nodes.find((node) => node.node_label === edge.target_label);
		if (!(sourceNode && targetNode)) {
			continue;
		}
		const source = buildNodeKey(sourceNode);
		const target = buildNodeKey(targetNode);
		graph.setEdge(source, target);
		const highlighted = activeLabel === edge.source_label || activeLabel === edge.target_label;
		edges.push({
			id: `course-map-edge-${index}-${source}-${target}`,
			source,
			target,
			type: "smoothstep",
			className: highlighted ? "course-map-graph-edge highlighted" : "course-map-graph-edge",
			animated: highlighted,
		});
	}

	dagre.layout(graph);

	const nodes: Node<GraphNodeData>[] = sortedNodes.map((node) => {
		const nodeId = buildNodeKey(node);
		const layoutNode = graph.node(nodeId);
		return {
			id: nodeId,
			position: {
				x: layoutNode.x - NODE_WIDTH / 2,
				y: layoutNode.y - NODE_HEIGHT / 2,
			},
			data: {
				label: node.node_label,
				stage: node.stage_label,
				groupLabel: ROUTE_GROUP_LABELS[node.route_group ?? "core"],
				related: relatedLabels.has(node.node_label),
			},
			draggable: false,
			selectable: true,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			type: "courseMapNode",
			className:
				nodeId === activeNodeKey
					? "course-map-graph-node selected"
					: relatedLabels.has(node.node_label)
						? "course-map-graph-node related"
						: "course-map-graph-node",
		};
	});

	return { nodes, edges };
}

function GraphContent({ data, activeNodeKey, onSelectNode }: Props) {
	const graph = useMemo(() => buildRelationGraph({ data, activeNodeKey }), [activeNodeKey, data]);

	return (
		<div className="course-map-graph-surface">
			<div className="course-map-graph-copy">
				<h4>课程关系图</h4>
				<p>这里用于查看依赖关系，不是默认阅读视图。点击节点可继续联动下方详情。</p>
			</div>
			<div className="course-map-graph-canvas">
				<ReactFlow
					nodes={graph.nodes}
					edges={graph.edges}
					nodeTypes={nodeTypes}
					fitView
					fitViewOptions={{ padding: 0.16 }}
					minZoom={0.45}
					maxZoom={1.4}
					onNodeClick={(_, node) => onSelectNode(node.id)}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable
					proOptions={{ hideAttribution: true }}
				>
					<Controls showInteractive={false} />
					<Background gap={18} size={1} color="#e2eee8" />
				</ReactFlow>
			</div>
		</div>
	);
}

export default function CourseRelationGraphView(props: Props) {
	return (
		<ReactFlowProvider>
			<GraphContent {...props} />
		</ReactFlowProvider>
	);
}
