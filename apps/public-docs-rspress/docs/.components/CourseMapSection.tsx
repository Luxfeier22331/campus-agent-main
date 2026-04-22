import { lazy, Suspense, useMemo, useState } from "react";
import "./course-map-section.css";
import { buildNodeKey, type CourseMapData, type CourseMapNode } from "./course-map-types";

const CourseRelationGraphView = lazy(() => import("./CourseRelationGraphView"));

type Props = {
  data: CourseMapData;
  imageSrc: string;
};

type CourseMapViewMode = "route" | "graph";

const ROUTE_GROUP_LABELS = {
  foundation: "公共基础",
  core: "专业核心",
  extension: "拓展与个性化",
  practice: "实践环节",
} as const;

const ROUTE_GROUP_ORDER = ["foundation", "core", "extension", "practice"] as const;

function resolveStageLabels(data: CourseMapData): string[] {
  return data.displayStageLabels.length
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
  data: CourseMapData;
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

function buildStageGroups({
  nodes,
}: {
  nodes: CourseMapNode[];
}): Array<{ group: keyof typeof ROUTE_GROUP_LABELS; items: CourseMapNode[] }> {
  return ROUTE_GROUP_ORDER.map((group) => ({
    group,
    items: nodes.filter((node) => resolveNodeGroup(node) === group),
  })).filter((entry) => entry.items.length > 0);
}

function CourseRouteMapView({
  data,
  activeNodeKey,
  onSelectNode,
}: {
  data: CourseMapData;
  activeNodeKey: string | null;
  onSelectNode: (nodeKey: string) => void;
}) {
  const stageLabels = resolveStageLabels(data);
  const activeNode =
    data.nodes.find((node) => buildNodeKey(node) === activeNodeKey) ?? null;
  const relatedLabels = buildRelatedLabelSet({ data, activeNode });

  return (
    <section className="course-map-route-shell">
      <div className="course-map-route-copy">
        <h4>培养路径</h4>
        <p>默认按学期展示课程路线。点击课程卡片可查看它的一跳关联课程。</p>
      </div>
      <div className="course-map-stage-strip" aria-label="课程路线图">
        {stageLabels.map((stageLabel) => {
          const stageNodes = data.nodes.filter((node) => node.stage_label === stageLabel);
          const groups = buildStageGroups({ nodes: stageNodes });
          if (!groups.length) {
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
                      {items.map((node) => {
                        const nodeKey = buildNodeKey(node);
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
                                  : "无前置"}
                                {" · "}
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
      </div>
    </section>
  );
}

export default function CourseMapSection({ data, imageSrc }: Props) {
  const stageLabels = resolveStageLabels(data);
  const initialNode = data.nodes[0] ?? null;
  const [activeNodeKey, setActiveNodeKey] = useState<string | null>(
    initialNode ? buildNodeKey(initialNode) : null,
  );
  const [viewMode, setViewMode] = useState<CourseMapViewMode>("route");
  const activeNode =
    data.nodes.find((node) => buildNodeKey(node) === activeNodeKey) ?? initialNode;
  const outgoingEdges = activeNode
    ? data.edges.filter((edge) => edge.source_label === activeNode.node_label)
    : [];
  const incomingEdges = activeNode
    ? data.edges.filter((edge) => edge.target_label === activeNode.node_label)
    : [];
  const activeGroupLabel = activeNode
    ? ROUTE_GROUP_LABELS[resolveNodeGroup(activeNode)]
    : null;
  const summary = useMemo(
    () => `${stageLabels.length} 个阶段 · ${data.nodes.length} 个节点 · ${data.edges.length} 条关系`,
    [data.edges.length, data.nodes.length, stageLabels.length],
  );

  return (
    <section className="course-map-shell">
      <header className="course-map-header">
        <div>
          <p className="course-map-eyebrow">已校对课程地图</p>
          <h3>{data.title}</h3>
          <p className="course-map-meta">来源页 {data.pageNumber} · {summary}</p>
        </div>
      </header>

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

      {viewMode === "route" ? (
        <CourseRouteMapView
          data={data}
          activeNodeKey={activeNodeKey}
          onSelectNode={setActiveNodeKey}
        />
      ) : (
        <Suspense
          fallback={
            <section className="course-map-graph-loading">
              <h4>正在加载关系图</h4>
              <p>关系图只在进入该视图后挂载，用于控制默认阅读页的复杂度。</p>
            </section>
          }
        >
          <CourseRelationGraphView
            data={data}
            activeNodeKey={activeNodeKey}
            onSelectNode={setActiveNodeKey}
          />
        </Suspense>
      )}

      {activeNode ? (
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
              {incomingEdges.length ? (
                <ul>
                  {incomingEdges.map((edge) => (
                    <li key={`${edge.source_label}->${edge.target_label}`}>{edge.source_label}</li>
                  ))}
                </ul>
              ) : (
                <p>未标出前置关系</p>
              )}
            </div>
            <div>
              <h5>后续节点</h5>
              {outgoingEdges.length ? (
                <ul>
                  {outgoingEdges.map((edge) => (
                    <li key={`${edge.source_label}->${edge.target_label}`}>{edge.target_label}</li>
                  ))}
                </ul>
              ) : (
                <p>未标出后续关系</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <details className="course-map-image-panel">
        <summary>查看原始课程地图裁切图</summary>
        <img alt={`${data.title} 原始裁切图`} src={imageSrc} />
      </details>

      {data.manualReviewNotes.length ? (
        <section className="course-map-notes">
          <h4>校对说明</h4>
          <ul>
            {data.manualReviewNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
