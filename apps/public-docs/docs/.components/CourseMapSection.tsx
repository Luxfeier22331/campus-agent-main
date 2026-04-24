import { lazy, Suspense, useMemo, useState } from "react";
import "./course-map-section.css";
import {
	buildNodeKey,
	buildNodeOccurrenceKey,
	type CourseMapBlock,
	type CourseMapDocumentData,
	type CourseMapEdge,
	type CourseMapNode,
} from "./course-map-types";

const CourseRelationGraphView = lazy(() => import("./CourseRelationGraphView"));

interface Props {
	data: CourseMapDocumentData;
}

type CourseMapViewMode = "route" | "graph";
interface IndexedCourseMapNode {
	node: CourseMapNode;
	nodeKey: string;
	index: number;
}

interface KeyedCourseMapEdge {
	edge: CourseMapEdge;
	edgeKey: string;
}

interface KeyedExtractionNote {
	note: string;
	noteKey: string;
}

const ROUTE_GROUP_LABELS = {
	foundation: "公共基础",
	core: "专业核心",
	extension: "拓展与个性化",
	practice: "实践环节",
} as const;

const ROUTE_GROUP_ORDER = ["foundation", "core", "extension", "practice"] as const;
const STATUS_LABELS = {
	ready: "已整理",
	partial: "部分整理",
	failed: "待整理",
} as const;

function resolveStageLabels(data: CourseMapBlock): string[] {
	return data.displayStageLabels.length > 0
		? data.displayStageLabels
		: Array.from(new Set(data.nodes.map((node) => node.stage_label).filter(Boolean)));
}

function resolveNodeGroup(node: CourseMapNode): keyof typeof ROUTE_GROUP_LABELS {
	const routeGroup = node.route_group ?? "core";
	return routeGroup in ROUTE_GROUP_LABELS ? routeGroup : "core";
}

function buildRelatedLabelSet({
	data,
	activeNode,
}: {
	data: CourseMapBlock;
	activeNode: CourseMapNode | null;
}): Set<string> {
	if (!activeNode) {
		return new Set();
	}
	const labels = new Set<string>();
	for (const edge of data.edges) {
		if (edge.source_label === activeNode.node_label) {
			labels.add(edge.target_label);
		}
		if (edge.target_label === activeNode.node_label) {
			labels.add(edge.source_label);
		}
	}
	return labels;
}

function buildIndexedNodes(data: CourseMapBlock): IndexedCourseMapNode[] {
	return data.nodes.map((node, index) => ({
		node,
		nodeKey: buildNodeOccurrenceKey(node, index),
		index,
	}));
}

function findNodeByActiveKey({
	data,
	activeNodeKey,
}: {
	data: CourseMapBlock;
	activeNodeKey: string | null;
}): CourseMapNode | null {
	if (!activeNodeKey) {
		return null;
	}
	return (
		buildIndexedNodes(data).find(
			({ node, nodeKey }) => nodeKey === activeNodeKey || buildNodeKey(node) === activeNodeKey,
		)?.node ?? null
	);
}

function buildKeyedEdges(edges: CourseMapEdge[], prefix: string): KeyedCourseMapEdge[] {
	const seen = new Map<string, number>();
	return edges.map((edge) => {
		const baseKey = `${prefix}:${edge.source_label}->${edge.target_label}`;
		const occurrence = seen.get(baseKey) ?? 0;
		seen.set(baseKey, occurrence + 1);
		return {
			edge,
			edgeKey: occurrence === 0 ? baseKey : `${baseKey}#${occurrence}`,
		};
	});
}

function buildKeyedExtractionNotes(notes: string[]): KeyedExtractionNote[] {
	const seen = new Map<string, number>();
	return notes.map((note) => {
		const occurrence = seen.get(note) ?? 0;
		seen.set(note, occurrence + 1);
		return {
			note,
			noteKey: occurrence === 0 ? note : `${note}#${occurrence}`,
		};
	});
}

function buildStageGroups({
	nodes,
}: {
	nodes: IndexedCourseMapNode[];
}): Array<{ group: keyof typeof ROUTE_GROUP_LABELS; items: IndexedCourseMapNode[] }> {
	return ROUTE_GROUP_ORDER.map((group) => ({
		group,
		items: nodes.filter(({ node }) => resolveNodeGroup(node) === group),
	})).filter((entry) => entry.items.length > 0);
}

function shouldShowGraph(data: CourseMapBlock): boolean {
	return data.nodes.length >= 2 && data.edges.length > 0;
}

function CourseRouteMapView({
	data,
	activeNodeKey,
	onSelectNode,
}: {
	data: CourseMapBlock;
	activeNodeKey: string | null;
	onSelectNode: (nodeKey: string) => void;
}) {
	const stageLabels = resolveStageLabels(data);
	const indexedNodes = buildIndexedNodes(data);
	const activeNode = findNodeByActiveKey({ data, activeNodeKey });
	const relatedLabels = buildRelatedLabelSet({ data, activeNode });

	return (
		<section className="course-map-route-shell">
			<div className="course-map-route-copy">
				<h4>培养路径</h4>
				<p>按学期展示课程安排。点击课程卡片可查看前置与后续关系。</p>
			</div>
			<section className="course-map-stage-strip" aria-label="课程路线图">
				{stageLabels.map((stageLabel) => {
					const stageNodes = indexedNodes.filter(({ node }) => node.stage_label === stageLabel);
					const groups = buildStageGroups({ nodes: stageNodes });
					if (groups.length === 0) {
						return null;
					}
					return (
						<section key={stageLabel} className="course-map-stage-column">
							<div className="course-map-stage-header">
								<h5>{stageLabel}</h5>
								<span>{stageNodes.length} 门</span>
							</div>
							<div className="course-map-stage-groups">
								{groups.map(({ group, items }) => (
									<section key={`${stageLabel}-${group}`} className="course-map-route-group">
										<h6>{ROUTE_GROUP_LABELS[group]}</h6>
										<div className="course-map-route-card-list">
											{items.map(({ node, nodeKey }) => {
												const selected = nodeKey === activeNodeKey;
												const related = !selected && relatedLabels.has(node.node_label);
												return (
													<button
														key={nodeKey}
														type="button"
														className={
															selected
																? "course-map-route-card selected"
																: related
																	? "course-map-route-card related"
																	: "course-map-route-card"
														}
														onClick={() => onSelectNode(nodeKey)}
													>
														<span className="course-map-route-card-title">{node.node_label}</span>
														<span className="course-map-route-card-meta">
															{ROUTE_GROUP_LABELS[resolveNodeGroup(node)]}
														</span>
														{(node.incoming_count ?? 0) > 0 || (node.outgoing_count ?? 0) > 0 ? (
															<span className="course-map-route-card-status">
																{(node.incoming_count ?? 0) > 0
																	? `${node.incoming_count} 个前置`
																	: "无前置"}{" "}
																·{" "}
																{(node.outgoing_count ?? 0) > 0
																	? `${node.outgoing_count} 个后续`
																	: "无后续"}
															</span>
														) : null}
													</button>
												);
											})}
										</div>
									</section>
								))}
							</div>
						</section>
					);
				})}
			</section>
		</section>
	);
}

function CourseMapDetail({
	data,
	activeNodeKey,
}: {
	data: CourseMapBlock;
	activeNodeKey: string | null;
}) {
	const activeNode = findNodeByActiveKey({ data, activeNodeKey }) ?? data.nodes[0] ?? null;
	if (!activeNode) {
		return null;
	}
	const outgoingEdges = data.edges.filter((edge) => edge.source_label === activeNode.node_label);
	const incomingEdges = data.edges.filter((edge) => edge.target_label === activeNode.node_label);
	const keyedIncomingEdges = buildKeyedEdges(incomingEdges, "incoming");
	const keyedOutgoingEdges = buildKeyedEdges(outgoingEdges, "outgoing");
	const activeGroupLabel = ROUTE_GROUP_LABELS[resolveNodeGroup(activeNode)];

	return (
		<section className="course-map-detail">
			<div className="course-map-detail-header">
				<div>
					<h4>{activeNode.node_label}</h4>
					<p>
						{activeNode.stage_label}
						{activeGroupLabel ? ` · ${activeGroupLabel}` : ""}
					</p>
				</div>
			</div>
			<div className="course-map-edge-columns">
				<div>
					<h5>前置节点</h5>
					{incomingEdges.length > 0 ? (
						<ul>
							{keyedIncomingEdges.map(({ edge, edgeKey }) => (
								<li key={edgeKey}>{edge.source_label}</li>
							))}
						</ul>
					) : (
						<p>未标出前置关系</p>
					)}
				</div>
				<div>
					<h5>后续节点</h5>
					{outgoingEdges.length > 0 ? (
						<ul>
							{keyedOutgoingEdges.map(({ edge, edgeKey }) => (
								<li key={edgeKey}>{edge.target_label}</li>
							))}
						</ul>
					) : (
						<p>未标出后续关系</p>
					)}
				</div>
			</div>
		</section>
	);
}

function CourseMapBlockSection({ block }: { block: CourseMapBlock }) {
	const stageLabels = resolveStageLabels(block);
	const initialNode = block.nodes[0] ?? null;
	const keyedExtractionNotes = buildKeyedExtractionNotes(block.extractionNotes);
	const [activeNodeKey, setActiveNodeKey] = useState<string | null>(
		initialNode ? buildNodeOccurrenceKey(initialNode, 0) : null,
	);
	const [viewMode, setViewMode] = useState<CourseMapViewMode>("route");
	const graphEnabled = shouldShowGraph(block);
	const summary = useMemo(
		() =>
			`${stageLabels.length} 个阶段 · ${block.nodes.length} 个节点 · ${block.edges.length} 条关系`,
		[block.edges.length, block.nodes.length, stageLabels.length],
	);

	return (
		<section className={`course-map-shell status-${block.status}`}>
			<header className="course-map-header">
				<div>
					<div className="course-map-title-row">
						<p className="course-map-eyebrow">课程地图</p>
						<span className={`course-map-status-badge status-${block.status}`}>
							{STATUS_LABELS[block.status]}
						</span>
					</div>
					<h3>{block.title}</h3>
					<p className="course-map-meta">
						来源页 {block.pageNumber}
						{block.status === "failed" ? "" : ` · ${summary}`}
					</p>
				</div>
			</header>

			{block.status === "failed" ? (
				<section className="course-map-failure-panel">
					<h4>暂未形成结构化课程关系</h4>
					<p>当前保留原始课程地图区域图。</p>
				</section>
			) : (
				<>
					{graphEnabled ? (
						<div className="course-map-view-toggle" role="tablist" aria-label="课程地图视图切换">
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === "route"}
								className={
									viewMode === "route" ? "course-map-view-tab selected" : "course-map-view-tab"
								}
								onClick={() => setViewMode("route")}
							>
								培养路径
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === "graph"}
								className={
									viewMode === "graph" ? "course-map-view-tab selected" : "course-map-view-tab"
								}
								onClick={() => setViewMode("graph")}
							>
								关系图
							</button>
						</div>
					) : null}

					{viewMode === "graph" && graphEnabled ? (
						<Suspense
							fallback={
								<section className="course-map-graph-loading">
									<h4>正在加载关系图</h4>
									<p>关系图用于查看课程之间的前后关系。</p>
								</section>
							}
						>
							<CourseRelationGraphView
								data={block}
								activeNodeKey={activeNodeKey}
								onSelectNode={setActiveNodeKey}
							/>
						</Suspense>
					) : (
						<CourseRouteMapView
							data={block}
							activeNodeKey={activeNodeKey}
							onSelectNode={setActiveNodeKey}
						/>
					)}

					<CourseMapDetail data={block} activeNodeKey={activeNodeKey} />
				</>
			)}

			<details className="course-map-image-panel">
				<summary>查看原始课程地图区域图</summary>
				<img alt={`${block.title} 原始区域图`} src={block.imageSrc} />
			</details>

			{block.extractionNotes.length > 0 ? (
				<section className="course-map-notes">
					<h4>整理说明</h4>
					<ul>
						{keyedExtractionNotes.map(({ note, noteKey }) => (
							<li key={noteKey}>{note}</li>
						))}
					</ul>
				</section>
			) : null}
		</section>
	);
}

export default function CourseMapSection({ data }: Props) {
	if (data.blocks.length === 0) {
		return null;
	}

	return (
		<section className="course-map-collection">
			{data.blocks.map((block) => (
				<CourseMapBlockSection key={block.blockId} block={block} />
			))}
		</section>
	);
}
