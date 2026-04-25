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
	useReactFlow,
} from "@xyflow/react";
import dagre from "dagre";
import { memo, useEffect, useMemo, useRef } from "react";
import "@xyflow/react/dist/style.css";
import type { CourseMapBlock, CourseMapNode } from "./course-map-types";

interface Props {
	data: CourseMapBlock;
	activeNodeId: string | null;
	onSelectNode: (nodeId: string) => void;
}

interface GraphNodeData extends Record<string, unknown> {
	label: string;
	stage: string;
	groupLabel: string;
	related: boolean;
}

interface IndexedCourseMapNode {
	node: CourseMapNode;
	nodeId: string;
	index: number;
}

const NODE_WIDTH = 196;
const NODE_HEIGHT = 84;
const GRAPH_MIN_ZOOM = 0.08;
const GRAPH_MAX_ZOOM = 1.4;
const GRAPH_FIT_VIEW_OPTIONS = {
	padding: 0.14,
	minZoom: GRAPH_MIN_ZOOM,
	maxZoom: GRAPH_MAX_ZOOM,
};

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

function buildRelatedNodeIdSet(data: CourseMapBlock, activeNodeId: string | null): Set<string> {
	if (!activeNodeId) {
		return new Set();
	}
	const nodeIds = new Set<string>();
	for (const edge of data.edges) {
		if (edge.source_node_id === activeNodeId) {
			nodeIds.add(edge.target_node_id);
		}
		if (edge.target_node_id === activeNodeId) {
			nodeIds.add(edge.source_node_id);
		}
	}
	return nodeIds;
}

function buildIndexedNodes(data: CourseMapBlock): IndexedCourseMapNode[] {
	return data.nodes.map((node, index) => ({
		node,
		nodeId: node.node_id,
		index,
	}));
}

function findIndexedNodeByActiveKey(
	nodes: IndexedCourseMapNode[],
	activeNodeId: string | null,
): IndexedCourseMapNode | null {
	if (!activeNodeId) {
		return null;
	}
	return nodes.find(({ nodeId }) => nodeId === activeNodeId) ?? null;
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
	activeNodeId,
}: {
	data: CourseMapBlock;
	activeNodeId: string | null;
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
	const indexedNodes = buildIndexedNodes(data);
	const sortedNodes = [...indexedNodes].sort((left, right) => {
		const leftStageIndex = stageLabels.indexOf(left.node.stage_label);
		const rightStageIndex = stageLabels.indexOf(right.node.stage_label);
		if (leftStageIndex !== rightStageIndex) {
			return leftStageIndex - rightStageIndex;
		}
		const groupDiff = routeGroupSortValue(left.node) - routeGroupSortValue(right.node);
		if (groupDiff !== 0) {
			return groupDiff;
		}
		const labelDiff = left.node.node_label.localeCompare(right.node.node_label, "zh-Hans-CN");
		return labelDiff === 0 ? left.index - right.index : labelDiff;
	});

	for (const { nodeId } of sortedNodes) {
		graph.setNode(nodeId, {
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
		});
	}

	const edges: Edge[] = [];
	const activeNode = findIndexedNodeByActiveKey(indexedNodes, activeNodeId);
	const activeResolvedNodeId = activeNode?.nodeId ?? null;
	const relatedNodeIds = buildRelatedNodeIdSet(data, activeResolvedNodeId);
	for (const edge of data.edges) {
		const sourceNode = indexedNodes.find(({ nodeId }) => nodeId === edge.source_node_id);
		const targetNode = indexedNodes.find(({ nodeId }) => nodeId === edge.target_node_id);
		if (!(sourceNode && targetNode)) {
			continue;
		}
		const source = sourceNode.nodeId;
		const target = targetNode.nodeId;
		graph.setEdge(source, target);
		const highlighted =
			activeResolvedNodeId === edge.source_node_id || activeResolvedNodeId === edge.target_node_id;
		edges.push({
			id: edge.edge_id,
			source,
			target,
			type: "smoothstep",
			className: highlighted ? "course-map-graph-edge highlighted" : "course-map-graph-edge",
			animated: highlighted,
		});
	}

	dagre.layout(graph);

	const nodes: Node<GraphNodeData>[] = sortedNodes.map(({ node, nodeId }) => {
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
				related: relatedNodeIds.has(nodeId),
			},
			draggable: false,
			selectable: true,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			type: "courseMapNode",
			style: {
				height: NODE_HEIGHT,
				width: NODE_WIDTH,
			},
			className:
				nodeId === activeResolvedNodeId
					? "course-map-graph-node selected"
					: relatedNodeIds.has(nodeId)
						? "course-map-graph-node related"
						: "course-map-graph-node",
		};
	});

	return { nodes, edges };
}

function GraphContent({ data, activeNodeId, onSelectNode }: Props) {
	const graph = useMemo(() => buildRelationGraph({ data, activeNodeId }), [activeNodeId, data]);
	const canvasRef = useRef<HTMLDivElement>(null);
	const reactFlow = useReactFlow<Node<GraphNodeData>, Edge>();

	useEffect(() => {
		if (graph.nodes.length === 0) {
			return;
		}

		let animationFrame: number | undefined;
		let delayedFit: number | undefined;
		const fitView = () => {
			void reactFlow.fitView(GRAPH_FIT_VIEW_OPTIONS);
		};
		const scheduleFitView = () => {
			if (animationFrame !== undefined) {
				window.cancelAnimationFrame(animationFrame);
			}
			if (delayedFit !== undefined) {
				window.clearTimeout(delayedFit);
			}
			animationFrame = window.requestAnimationFrame(() => {
				animationFrame = window.requestAnimationFrame(fitView);
			});
			delayedFit = window.setTimeout(fitView, 180);
		};

		scheduleFitView();
		window.addEventListener("resize", scheduleFitView);
		const canvas = canvasRef.current;
		if (!canvas || typeof ResizeObserver === "undefined") {
			return () => {
				window.removeEventListener("resize", scheduleFitView);
				if (animationFrame !== undefined) {
					window.cancelAnimationFrame(animationFrame);
				}
				if (delayedFit !== undefined) {
					window.clearTimeout(delayedFit);
				}
			};
		}

		const observer = new ResizeObserver(scheduleFitView);
		observer.observe(canvas);
		return () => {
			window.removeEventListener("resize", scheduleFitView);
			observer.disconnect();
			if (animationFrame !== undefined) {
				window.cancelAnimationFrame(animationFrame);
			}
			if (delayedFit !== undefined) {
				window.clearTimeout(delayedFit);
			}
		};
	}, [graph.nodes.length, reactFlow]);

	return (
		<div className="course-map-graph-surface">
			<div className="course-map-graph-copy">
				<h4>课程关系图</h4>
				<p>这里用于查看全局拓扑，不是默认阅读视图。点击节点会同步选中课程关系检查器。</p>
			</div>
			<div className="course-map-graph-canvas" ref={canvasRef}>
				<ReactFlow
					nodes={graph.nodes}
					edges={graph.edges}
					nodeTypes={nodeTypes}
					fitView
					fitViewOptions={GRAPH_FIT_VIEW_OPTIONS}
					minZoom={GRAPH_MIN_ZOOM}
					maxZoom={GRAPH_MAX_ZOOM}
					onNodeClick={(_, node) => onSelectNode(node.id)}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable
					proOptions={{ hideAttribution: true }}
				>
					<Controls fitViewOptions={GRAPH_FIT_VIEW_OPTIONS} showInteractive={false} />
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
