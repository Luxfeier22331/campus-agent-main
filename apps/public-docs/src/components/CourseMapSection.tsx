import { useId, useState } from "react";
import "./course-map-section.css";
import type {
	CourseMapBlock,
	CourseMapDocumentData,
	CourseMapEdge,
	CourseMapNode,
	CourseMapStatus,
} from "./course-map-types";

interface Props {
	data: CourseMapDocumentData;
}

interface IndexedCourseMapNode {
	node: CourseMapNode;
	nodeId: string;
}

interface KeyedExtractionNote {
	note: string;
	noteKey: string;
}

interface CourseRelation {
	edge: CourseMapEdge;
	label: string;
}

interface CourseRelations {
	incoming: CourseRelation[];
	outgoing: CourseRelation[];
}

const SEARCH_NODE_COUNT_THRESHOLD = 40;

const ROUTE_GROUP_LABELS = {
	foundation: "公共基础",
	core: "专业核心",
	extension: "拓展与个性化",
	practice: "实践环节",
} as const;

const ROUTE_GROUP_ORDER = ["foundation", "core", "extension", "practice"] as const;

const STATUS_LABELS = {
	ready: "已整理",
	partial: "需核对",
	failed: "仅原图",
} as const;

const STATUS_DESCRIPTIONS = {
	ready: "结构化课程路径已生成，原始区域图保留用于核对。",
	partial: "结构化课程路径已生成，部分边界仍建议结合原图核对。",
	failed: "暂未形成结构化课程路径，仅保留原始区域图。",
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
	return data.nodes.map((node) => ({
		node,
		nodeId: node.node_id,
	}));
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

function buildRelationLookup(block: CourseMapBlock): Map<string, CourseRelations> {
	const lookup = new Map<string, CourseRelations>();
	const nodeIds = new Set(block.nodes.map((node) => node.node_id));
	for (const node of block.nodes) {
		lookup.set(node.node_id, { incoming: [], outgoing: [] });
	}
	for (const edge of block.edges) {
		const sourceRelations = lookup.get(edge.source_node_id);
		const targetRelations = lookup.get(edge.target_node_id);
		if (!(sourceRelations && targetRelations)) {
			continue;
		}
		sourceRelations.outgoing.push({
			edge,
			label: nodeIds.has(edge.target_node_id)
				? edge.target_label
				: `${edge.target_label}（未定位）`,
		});
		targetRelations.incoming.push({
			edge,
			label: nodeIds.has(edge.source_node_id)
				? edge.source_label
				: `${edge.source_label}（未定位）`,
		});
	}
	return lookup;
}

function hasPublishableStructure(block: CourseMapBlock): boolean {
	return block.nodes.length > 0 && resolveStageLabels(block).length > 0;
}

function resolveEffectiveBlockStatus(block: CourseMapBlock): CourseMapStatus {
	return block.status === "failed" || !hasPublishableStructure(block) ? "failed" : block.status;
}

function buildCourseMapSummary(
	block: CourseMapBlock,
	effectiveStatus: CourseMapStatus = resolveEffectiveBlockStatus(block),
): string {
	const stageCount = resolveStageLabels(block).length;
	return effectiveStatus === "failed"
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
		<details className="course-map-search">
			<summary>
				<span>筛选课程</span>
				<small>
					{resultCount}/{nodeCount}
				</small>
			</summary>
			<div className="course-map-search-control">
				<label htmlFor={searchInputId}>按课程名、阶段或类别筛选</label>
				<input
					id={searchInputId}
					type="search"
					value={query}
					placeholder="输入课程名、阶段或类别"
					onChange={(event) => onChange(event.target.value)}
				/>
			</div>
		</details>
	);
}

function RelationColumn({
	title,
	emptyLabel,
	relations,
}: {
	title: string;
	emptyLabel: string;
	relations: CourseRelation[];
}) {
	return (
		<section className="course-map-relation-column">
			<h6>{title}</h6>
			{relations.length > 0 ? (
				<ul>
					{relations.map(({ edge, label }) => (
						<li key={`${title}:${edge.edge_id}`}>{label}</li>
					))}
				</ul>
			) : (
				<p>{emptyLabel}</p>
			)}
		</section>
	);
}

function CourseRouteCard({ node, relations }: { node: CourseMapNode; relations: CourseRelations }) {
	const incomingCount = relations.incoming.length;
	const outgoingCount = relations.outgoing.length;
	const hasRelations = incomingCount > 0 || outgoingCount > 0;
	const relationLabel = hasRelations
		? `${incomingCount > 0 ? `${incomingCount} 个前置` : "无前置"} · ${
				outgoingCount > 0 ? `${outgoingCount} 个后续` : "无后续"
			}`
		: "未标出前后关系";

	return (
		<article className="course-map-route-card">
			<header className="course-map-route-card-main">
				<strong className="course-map-route-card-title">{node.node_label}</strong>
				<span className="course-map-route-card-meta">
					{ROUTE_GROUP_LABELS[resolveNodeGroup(node)]}
					{node.category_label ? ` · ${node.category_label}` : ""}
				</span>
			</header>
			{hasRelations ? (
				<details className="course-map-course-relations">
					<summary>{relationLabel}</summary>
					<div className="course-map-relation-grid">
						<RelationColumn
							title="前置"
							emptyLabel="未标出前置课程"
							relations={relations.incoming}
						/>
						<RelationColumn
							title="后续"
							emptyLabel="未标出后续课程"
							relations={relations.outgoing}
						/>
					</div>
				</details>
			) : (
				<p className="course-map-route-card-status">{relationLabel}</p>
			)}
		</article>
	);
}

function CourseRouteMapView({
	data,
	indexedNodes,
	query,
	relationLookup,
}: {
	data: CourseMapBlock;
	indexedNodes: IndexedCourseMapNode[];
	query: string;
	relationLookup: Map<string, CourseRelations>;
}) {
	const stageLabels = resolveStageLabels(data);
	const visibleNodes = indexedNodes.filter(({ node }) => matchesCourseQuery(node, query));

	return (
		<section className="course-map-route-panel" aria-label="课程路径">
			<div className="course-map-route-copy">
				<h4>按培养阶段阅读</h4>
				<p>默认展示整理后的课程路径。前置和后续课程收在条目内，按需展开核对。</p>
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
												{items.map(({ node, nodeId }) => (
													<CourseRouteCard
														key={nodeId}
														node={node}
														relations={relationLookup.get(nodeId) ?? { incoming: [], outgoing: [] }}
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

function CourseMapBlockSection({ block }: { block: CourseMapBlock }) {
	const indexedNodes = buildIndexedNodes(block);
	const keyedExtractionNotes = buildKeyedExtractionNotes(block.extractionNotes);
	const [courseQuery, setCourseQuery] = useState("");
	const effectiveStatus = resolveEffectiveBlockStatus(block);
	const showSearch =
		effectiveStatus !== "failed" && block.nodes.length > SEARCH_NODE_COUNT_THRESHOLD;
	const normalizedCourseQuery = showSearch ? courseQuery.trim() : "";
	const visibleNodeCount = indexedNodes.filter(({ node }) =>
		matchesCourseQuery(node, normalizedCourseQuery),
	).length;
	const relationLookup = buildRelationLookup(block);
	const summary = buildCourseMapSummary(block, effectiveStatus);

	return (
		<section className={`course-map-shell status-${effectiveStatus}`}>
			<header className="course-map-header">
				<div className="course-map-title-row">
					<p className="course-map-eyebrow">课程地图</p>
					{effectiveStatus === "ready" ? null : (
						<span className={`course-map-status-badge status-${effectiveStatus}`}>
							{STATUS_LABELS[effectiveStatus]}
						</span>
					)}
				</div>
				<h3>{block.title}</h3>
				<p className="course-map-meta">{summary}</p>
				{effectiveStatus !== "ready" ? (
					<p className="course-map-status-copy">{STATUS_DESCRIPTIONS[effectiveStatus]}</p>
				) : null}
			</header>

			{effectiveStatus === "failed" ? (
				<section className="course-map-failure-panel">
					<h4>暂未形成结构化课程路径</h4>
					<p>{STATUS_DESCRIPTIONS[effectiveStatus]}</p>
				</section>
			) : (
				<>
					{showSearch ? (
						<CourseMapSearch
							query={courseQuery}
							onChange={setCourseQuery}
							nodeCount={block.nodes.length}
							resultCount={visibleNodeCount}
						/>
					) : null}
					<CourseRouteMapView
						data={block}
						indexedNodes={indexedNodes}
						query={normalizedCourseQuery}
						relationLookup={relationLookup}
					/>
				</>
			)}

			<details className="course-map-image-panel">
				<summary>查看原始课程地图区域图</summary>
				<p>原图仅用于核对结构化结果，不作为默认阅读入口。</p>
				<img alt={`${block.title} 原始区域图`} src={block.imageSrc} />
			</details>

			{block.extractionNotes.length > 0 ? (
				<details className="course-map-notes">
					<summary>查看整理说明</summary>
					<ul>
						{keyedExtractionNotes.map(({ note, noteKey }) => (
							<li key={noteKey}>{note}</li>
						))}
					</ul>
				</details>
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
			<div className="course-map-document-nav-list" role="tablist" aria-label="切换课程地图">
				{blocks.map((block) => {
					const selected = block.blockId === activeBlockId;
					const effectiveStatus = resolveEffectiveBlockStatus(block);
					return (
						<button
							key={block.blockId}
							type="button"
							role="tab"
							aria-selected={selected}
							className={
								selected ? "course-map-document-nav-tab selected" : "course-map-document-nav-tab"
							}
							onClick={() => onSelectBlock(block.blockId)}
						>
							<strong>{block.title}</strong>
							<small>{buildCourseMapSummary(block, effectiveStatus)}</small>
						</button>
					);
				})}
			</div>
		</nav>
	);
}

export default function CourseMapSection({ data }: Props) {
	const [activeBlockId, setActiveBlockId] = useState<string | null>(
		data.blocks[0]?.blockId ?? null,
	);
	if (data.blocks.length === 0) {
		return null;
	}
	const activeBlock =
		data.blocks.find((block) => block.blockId === activeBlockId) ?? data.blocks[0];

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
