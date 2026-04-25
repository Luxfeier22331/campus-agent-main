import { lazy, Suspense, useDeferredValue, useId, useMemo, useState } from "react";
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

interface IndexedCourseMapNode {
	node: CourseMapNode;
	nodeKey: string;
	index: number;
}

interface KeyedCourseMapEdge {
	edge: CourseMapEdge;
	edgeKey: string;
	targetNodeKey: string | null;
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

const STATUS_DESCRIPTIONS = {
	ready: "已提取为可阅读的课程路径，并保留原始区域图用于校对。",
	partial: "已发布结构化课程路径，但仍建议结合原始区域图核对边界。",
	failed: "暂未形成结构化路径，仅保留原始区域图。",
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

function buildIndexedNodes(data: CourseMapBlock): IndexedCourseMapNode[] {
	return data.nodes.map((node, index) => ({
		node,
		nodeKey: buildNodeOccurrenceKey(node, index),
		index,
	}));
}

function buildNodeKeyByLabel(nodes: IndexedCourseMapNode[]): Map<string, string> {
	const nodeKeyByLabel = new Map<string, string>();
	for (const { node, nodeKey } of nodes) {
		if (!nodeKeyByLabel.has(node.node_label)) {
			nodeKeyByLabel.set(node.node_label, nodeKey);
		}
	}
	return nodeKeyByLabel;
}

function findIndexedNodeByActiveKey({
	indexedNodes,
	activeNodeKey,
}: {
	indexedNodes: IndexedCourseMapNode[];
	activeNodeKey: string | null;
}): IndexedCourseMapNode | null {
	if (!activeNodeKey) {
		return null;
	}
	return (
		indexedNodes.find(
			({ node, nodeKey }) => nodeKey === activeNodeKey || buildNodeKey(node) === activeNodeKey,
		) ?? null
	);
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

function buildKeyedEdges({
	edges,
	nodeKeyByLabel,
	prefix,
	targetLabelSelector,
}: {
	edges: CourseMapEdge[];
	nodeKeyByLabel: Map<string, string>;
	prefix: string;
	targetLabelSelector: (edge: CourseMapEdge) => string;
}): KeyedCourseMapEdge[] {
	const seen = new Map<string, number>();
	return edges.map((edge) => {
		const baseKey = `${prefix}:${edge.source_label}->${edge.target_label}`;
		const occurrence = seen.get(baseKey) ?? 0;
		seen.set(baseKey, occurrence + 1);
		const label = targetLabelSelector(edge);
		return {
			edge,
			edgeKey: occurrence === 0 ? baseKey : `${baseKey}#${occurrence}`,
			targetNodeKey: nodeKeyByLabel.get(label) ?? null,
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

function matchesCourseQuery(node: CourseMapNode, query: string): boolean {
	if (!query) {
		return true;
	}
	const haystack = `${node.node_label} ${node.stage_label} ${node.category_label} ${
		ROUTE_GROUP_LABELS[resolveNodeGroup(node)]
	}`.toLocaleLowerCase("zh-Hans-CN");
	return haystack.includes(query.toLocaleLowerCase("zh-Hans-CN"));
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

function buildCourseMapSummary(block: CourseMapBlock): string {
	const stageCount = resolveStageLabels(block).length;
	return block.status === "failed"
		? `来源页 ${block.pageNumber} · 待整理`
		: `来源页 ${block.pageNumber} · ${stageCount} 个阶段 · ${block.nodes.length} 门课程 · ${block.edges.length} 条关系`;
}

function CourseMapSearch({
	query,
	onChange,
	nodeCount,
	resultCount,
}: {
	query: string;
	onChange: (query: string) => void;
	nodeCount: number;
	resultCount: number;
}) {
	const searchInputId = useId();

	return (
		<div className="course-map-search">
			<label htmlFor={searchInputId}>在这张课程地图中查找</label>
			<div className="course-map-search-control">
				<input
					id={searchInputId}
					type="search"
					value={query}
					placeholder="输入课程名、阶段或类别"
					onChange={(event) => onChange(event.target.value)}
				/>
				<span>
					{resultCount}/{nodeCount}
				</span>
			</div>
		</div>
	);
}

function CourseRouteCard({
	node,
	nodeKey,
	selected,
	related,
	onSelectNode,
}: {
	node: CourseMapNode;
	nodeKey: string;
	selected: boolean;
	related: boolean;
	onSelectNode: (nodeKey: string) => void;
}) {
	const incomingCount = node.incoming_count ?? 0;
	const outgoingCount = node.outgoing_count ?? 0;
	const relationLabel =
		incomingCount > 0 || outgoingCount > 0
			? `${incomingCount > 0 ? `${incomingCount} 个前置` : "无前置"} · ${
					outgoingCount > 0 ? `${outgoingCount} 个后续` : "无后续"
				}`
			: "未标出依赖";

	return (
		<button
			type="button"
			aria-pressed={selected}
			className={
				selected
					? "course-map-route-card selected"
					: related
						? "course-map-route-card related"
						: "course-map-route-card"
			}
			onClick={() => onSelectNode(nodeKey)}
		>
			<span className="course-map-route-card-main">
				<span className="course-map-route-card-title">{node.node_label}</span>
				<span className="course-map-route-card-meta">
					{ROUTE_GROUP_LABELS[resolveNodeGroup(node)]}
					{node.category_label ? ` · ${node.category_label}` : ""}
				</span>
			</span>
			<span className="course-map-route-card-status">{relationLabel}</span>
		</button>
	);
}

function CourseRouteMapView({
	data,
	indexedNodes,
	activeNodeKey,
	query,
	onSelectNode,
}: {
	data: CourseMapBlock;
	indexedNodes: IndexedCourseMapNode[];
	activeNodeKey: string | null;
	query: string;
	onSelectNode: (nodeKey: string) => void;
}) {
	const stageLabels = resolveStageLabels(data);
	const activeEntry = findIndexedNodeByActiveKey({ indexedNodes, activeNodeKey });
	const relatedLabels = buildRelatedLabelSet({ data, activeNode: activeEntry?.node ?? null });
	const visibleNodes = indexedNodes.filter(({ node }) => matchesCourseQuery(node, query));

	return (
		<section className="course-map-route-panel" aria-label="课程路径">
			<div className="course-map-route-copy">
				<h4>按培养阶段阅读</h4>
				<p>优先展示可读路径。选择任意课程后，右侧会显示它的前置与后续关系。</p>
			</div>
			{visibleNodes.length === 0 ? (
				<div className="course-map-empty-filter">
					<h5>没有匹配的课程</h5>
					<p>请换一个课程名称、阶段或类别关键词。</p>
				</div>
			) : (
				<div className="course-map-stage-list">
					{stageLabels.map((stageLabel) => {
						const stageNodes = visibleNodes.filter(({ node }) => node.stage_label === stageLabel);
						const groups = buildStageGroups({ nodes: stageNodes });
						if (groups.length === 0) {
							return null;
						}
						return (
							<section key={stageLabel} className="course-map-stage-row">
								<header className="course-map-stage-header">
									<div>
										<span>阶段</span>
										<h5>{stageLabel}</h5>
									</div>
									<strong>{stageNodes.length} 门</strong>
								</header>
								<div className="course-map-stage-groups">
									{groups.map(({ group, items }) => (
										<section key={`${stageLabel}-${group}`} className="course-map-route-group">
											<h6>{ROUTE_GROUP_LABELS[group]}</h6>
											<div className="course-map-route-card-list">
												{items.map(({ node, nodeKey }) => (
													<CourseRouteCard
														key={nodeKey}
														node={node}
														nodeKey={nodeKey}
														selected={nodeKey === activeNodeKey}
														related={
															nodeKey !== activeNodeKey && relatedLabels.has(node.node_label)
														}
														onSelectNode={onSelectNode}
													/>
												))}
											</div>
										</section>
									))}
								</div>
							</section>
						);
					})}
				</div>
			)}
		</section>
	);
}

function RelationList({
	title,
	emptyLabel,
	edges,
	labelSelector,
	onSelectNode,
}: {
	title: string;
	emptyLabel: string;
	edges: KeyedCourseMapEdge[];
	labelSelector: (edge: CourseMapEdge) => string;
	onSelectNode: (nodeKey: string) => void;
}) {
	return (
		<section className="course-map-relation-group">
			<h5>{title}</h5>
			{edges.length > 0 ? (
				<ul>
					{edges.map(({ edge, edgeKey, targetNodeKey }) => {
						const label = labelSelector(edge);
						return (
							<li key={edgeKey}>
								{targetNodeKey ? (
									<button type="button" onClick={() => onSelectNode(targetNodeKey)}>
										{label}
									</button>
								) : (
									<span>{label}</span>
								)}
							</li>
						);
					})}
				</ul>
			) : (
				<p>{emptyLabel}</p>
			)}
		</section>
	);
}

function CourseMapInspector({
	data,
	indexedNodes,
	activeNodeKey,
	onSelectNode,
}: {
	data: CourseMapBlock;
	indexedNodes: IndexedCourseMapNode[];
	activeNodeKey: string | null;
	onSelectNode: (nodeKey: string) => void;
}) {
	const activeEntry =
		findIndexedNodeByActiveKey({ indexedNodes, activeNodeKey }) ?? indexedNodes[0] ?? null;
	if (!activeEntry) {
		return null;
	}
	const activeNode = activeEntry.node;
	const nodeKeyByLabel = buildNodeKeyByLabel(indexedNodes);
	const incomingEdges = data.edges.filter((edge) => edge.target_label === activeNode.node_label);
	const outgoingEdges = data.edges.filter((edge) => edge.source_label === activeNode.node_label);
	const keyedIncomingEdges = buildKeyedEdges({
		edges: incomingEdges,
		nodeKeyByLabel,
		prefix: "incoming",
		targetLabelSelector: (edge) => edge.source_label,
	});
	const keyedOutgoingEdges = buildKeyedEdges({
		edges: outgoingEdges,
		nodeKeyByLabel,
		prefix: "outgoing",
		targetLabelSelector: (edge) => edge.target_label,
	});

	return (
		<aside className="course-map-inspector" aria-label="当前课程关系">
			<div className="course-map-inspector-card">
				<p className="course-map-inspector-eyebrow">当前选中</p>
				<h4>{activeNode.node_label}</h4>
				<div className="course-map-inspector-meta">
					<span>{activeNode.stage_label}</span>
					<span>{ROUTE_GROUP_LABELS[resolveNodeGroup(activeNode)]}</span>
					{activeNode.category_label ? <span>{activeNode.category_label}</span> : null}
				</div>
				<div className="course-map-relation-grid">
					<RelationList
						title="前置课程"
						emptyLabel="未标出前置关系"
						edges={keyedIncomingEdges}
						labelSelector={(edge) => edge.source_label}
						onSelectNode={onSelectNode}
					/>
					<RelationList
						title="后续课程"
						emptyLabel="未标出后续关系"
						edges={keyedOutgoingEdges}
						labelSelector={(edge) => edge.target_label}
						onSelectNode={onSelectNode}
					/>
				</div>
			</div>
		</aside>
	);
}

function CourseMapBlockSection({ block }: { block: CourseMapBlock }) {
	const stageLabels = resolveStageLabels(block);
	const indexedNodes = useMemo(() => buildIndexedNodes(block), [block]);
	const initialNode = indexedNodes[0] ?? null;
	const keyedExtractionNotes = buildKeyedExtractionNotes(block.extractionNotes);
	const [activeNodeKey, setActiveNodeKey] = useState<string | null>(initialNode?.nodeKey ?? null);
	const [courseQuery, setCourseQuery] = useState("");
	const [overviewOpen, setOverviewOpen] = useState(false);
	const deferredCourseQuery = useDeferredValue(courseQuery.trim());
	const graphEnabled = shouldShowGraph(block);
	const visibleNodeCount = indexedNodes.filter(({ node }) =>
		matchesCourseQuery(node, deferredCourseQuery),
	).length;
	const summary = buildCourseMapSummary(block);

	return (
		<section className={`course-map-shell status-${block.status}`}>
			<header className="course-map-header">
				<div className="course-map-title-row">
					<p className="course-map-eyebrow">课程地图</p>
					<span className={`course-map-status-badge status-${block.status}`}>
						{STATUS_LABELS[block.status]}
					</span>
				</div>
				<div className="course-map-heading-grid">
					<div>
						<h3>{block.title}</h3>
						<p className="course-map-meta">
							{summary}
						</p>
					</div>
					{block.status === "failed" ? null : (
						<div className="course-map-stat-grid">
							<div>
								<span>阶段</span>
								<strong>{stageLabels.length}</strong>
							</div>
							<div>
								<span>课程</span>
								<strong>{block.nodes.length}</strong>
							</div>
							<div>
								<span>关系</span>
								<strong>{block.edges.length}</strong>
							</div>
						</div>
					)}
				</div>
				<p className="course-map-status-copy">{STATUS_DESCRIPTIONS[block.status]}</p>
			</header>

			{block.status === "failed" ? (
				<section className="course-map-failure-panel">
					<h4>暂未形成结构化课程路径</h4>
					<p>当前只保留原始课程地图区域图，后续重新识别后再进入结构化阅读。</p>
				</section>
			) : (
				<>
					<CourseMapSearch
						query={courseQuery}
						onChange={setCourseQuery}
						nodeCount={block.nodes.length}
						resultCount={visibleNodeCount}
					/>
					<div className="course-map-explorer">
						<CourseRouteMapView
							data={block}
							indexedNodes={indexedNodes}
							activeNodeKey={activeNodeKey}
							query={deferredCourseQuery}
							onSelectNode={setActiveNodeKey}
						/>
						<CourseMapInspector
							data={block}
							indexedNodes={indexedNodes}
							activeNodeKey={activeNodeKey}
							onSelectNode={setActiveNodeKey}
						/>
					</div>
					{graphEnabled ? (
						<details
							className="course-map-overview-panel"
							onToggle={(event) => setOverviewOpen(event.currentTarget.open)}
						>
							<summary>查看全局关系总览</summary>
							<p>
								总览用于观察整体拓扑，不作为默认阅读视图。需要阅读课程名称时，请使用上方路径卡片。
							</p>
							{overviewOpen ? (
								<Suspense
									fallback={
										<section className="course-map-graph-loading">
											<h4>正在加载关系总览</h4>
											<p>关系总览用于查看课程之间的前后关系。</p>
										</section>
									}
								>
									<CourseRelationGraphView
										data={block}
										activeNodeKey={activeNodeKey}
										onSelectNode={setActiveNodeKey}
									/>
								</Suspense>
							) : null}
						</details>
					) : null}
				</>
			)}

			<details className="course-map-image-panel">
				<summary>查看原始课程地图区域图</summary>
				<p>原图用于人工核对结构化结果，不作为默认阅读入口。</p>
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

function CourseMapDocumentNav({
	blocks,
	activeBlockId,
	onSelectBlock,
}: {
	blocks: CourseMapBlock[];
	activeBlockId: string | null;
	onSelectBlock: (blockId: string) => void;
}) {
	return (
		<nav className="course-map-document-nav" aria-label="课程地图列表">
			<div className="course-map-document-nav-header">
				<div>
					<p className="course-map-eyebrow">课程地图</p>
					<h3>本页课程地图</h3>
				</div>
				<span>{blocks.length} 张</span>
			</div>
			<div className="course-map-document-nav-list">
				{blocks.map((block) => {
					const selected = block.blockId === activeBlockId;
					return (
						<button
							key={block.blockId}
							type="button"
							aria-pressed={selected}
							className={
								selected ? "course-map-document-nav-card selected" : "course-map-document-nav-card"
							}
							onClick={() => onSelectBlock(block.blockId)}
						>
							<span className="course-map-document-nav-card-main">
								<strong>{block.title}</strong>
								<small>{buildCourseMapSummary(block)}</small>
							</span>
							<span className={`course-map-status-badge status-${block.status}`}>
								{STATUS_LABELS[block.status]}
							</span>
						</button>
					);
				})}
			</div>
		</nav>
	);
}

export default function CourseMapSection({ data }: Props) {
	const [activeBlockId, setActiveBlockId] = useState<string | null>(data.blocks[0]?.blockId ?? null);
	if (data.blocks.length === 0) {
		return null;
	}
	const activeBlock = data.blocks.find((block) => block.blockId === activeBlockId) ?? data.blocks[0];

	return (
		<section className="course-map-collection">
			{data.blocks.length > 1 ? (
				<CourseMapDocumentNav
					blocks={data.blocks}
					activeBlockId={activeBlock.blockId}
					onSelectBlock={setActiveBlockId}
				/>
			) : null}
			<CourseMapBlockSection key={activeBlock.blockId} block={activeBlock} />
		</section>
	);
}
