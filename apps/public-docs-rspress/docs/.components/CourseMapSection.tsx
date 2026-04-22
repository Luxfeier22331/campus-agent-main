import { useState, type ReactNode } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./course-map-section.css";

type CourseMapNode = {
  node_label: string;
  stage_label: string;
  category_label: string;
};

type CourseMapEdge = {
  source_label: string;
  target_label: string;
};

type CourseMapData = {
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

type Props = {
  data: CourseMapData;
  imageSrc: string;
};

type CourseFlowNodeData = {
  label: ReactNode;
  stage: string;
  selected: boolean;
};

const STAGE_X_STEP = 240;
const NODE_Y_STEP = 108;
const COLUMN_PADDING = 28;
const ROW_PADDING = 28;

function buildNodeKey(node: CourseMapNode): string {
  return `${node.stage_label}::${node.node_label}`;
}

function buildStageLabels(data: CourseMapData): string[] {
  return data.displayStageLabels.length
    ? data.displayStageLabels
    : Array.from(new Set(data.nodes.map((node) => node.stage_label).filter(Boolean)));
}

function buildFlowNodes({
  data,
  stageLabels,
  activeNodeKey,
}: {
  data: CourseMapData;
  stageLabels: string[];
  activeNodeKey: string | null;
}): Node<CourseFlowNodeData>[] {
  return data.nodes.map((node, index) => {
    const stageIndex = Math.max(0, stageLabels.indexOf(node.stage_label));
    const rowIndex = data.nodes
      .slice(0, index)
      .filter((candidate) => candidate.stage_label === node.stage_label).length;
    const nodeKey = buildNodeKey(node);
    return {
      id: nodeKey,
      position: {
        x: COLUMN_PADDING + stageIndex * STAGE_X_STEP,
        y: ROW_PADDING + rowIndex * NODE_Y_STEP,
      },
      data: {
        label: (
          <div>
            <div className="course-map-flow-stage">{node.stage_label}</div>
            <div className="course-map-flow-label">{node.node_label}</div>
          </div>
        ),
        stage: node.stage_label,
        selected: nodeKey === activeNodeKey,
      },
      draggable: false,
      selectable: true,
      className: nodeKey === activeNodeKey ? "course-map-flow-node selected" : "course-map-flow-node",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

function buildFlowEdges({
  data,
  activeNodeKey,
}: {
  data: CourseMapData;
  activeNodeKey: string | null;
}): Edge[] {
  const knownNodes = new Set(data.nodes.map((node) => buildNodeKey(node)));
  const activeLabel = activeNodeKey?.split("::").slice(1).join("::") ?? null;
  return data.edges
    .map((edge, index) => {
      const source = resolveEdgeNodeId(data.nodes, edge.source_label, knownNodes);
      const target = resolveEdgeNodeId(data.nodes, edge.target_label, knownNodes);
      if (!source || !target) {
        return null;
      }
      const highlighted = activeLabel === edge.source_label || activeLabel === edge.target_label;
      return {
        id: `edge-${index}-${source}-${target}`,
        source,
        target,
        type: "smoothstep",
        animated: highlighted,
        className: highlighted ? "course-map-flow-edge highlighted" : "course-map-flow-edge",
      } satisfies Edge;
    })
    .filter((edge): edge is Edge => edge !== null);
}

function resolveEdgeNodeId(
  nodes: CourseMapNode[],
  nodeLabel: string,
  knownNodes: Set<string>,
): string | null {
  const exact = nodes.find((node) => buildNodeKey(node) === nodeLabel);
  if (exact && knownNodes.has(buildNodeKey(exact))) {
    return buildNodeKey(exact);
  }
  const matched = nodes.find((node) => node.node_label === nodeLabel);
  return matched ? buildNodeKey(matched) : null;
}

function buildFlowHeight(data: CourseMapData, stageLabels: string[]): number {
  const maxRows = Math.max(
    1,
    ...stageLabels.map(
      (stageLabel) => data.nodes.filter((node) => node.stage_label === stageLabel).length,
    ),
  );
  return Math.max(420, ROW_PADDING * 2 + maxRows * NODE_Y_STEP);
}

function CourseMapSectionContent({ data, imageSrc }: Props) {
  const stageLabels = buildStageLabels(data);
  const initialNode = data.nodes[0] ?? null;
  const [activeNodeKey, setActiveNodeKey] = useState<string | null>(
    initialNode ? buildNodeKey(initialNode) : null,
  );
  const activeNode =
    data.nodes.find((node) => buildNodeKey(node) === activeNodeKey) ?? initialNode;
  const outgoingEdges = activeNode
    ? data.edges.filter((edge) => edge.source_label === activeNode.node_label)
    : [];
  const incomingEdges = activeNode
    ? data.edges.filter((edge) => edge.target_label === activeNode.node_label)
    : [];
  const flowNodes = buildFlowNodes({
    data,
    stageLabels,
    activeNodeKey,
  });
  const flowEdges = buildFlowEdges({
    data,
    activeNodeKey,
  });
  const flowHeight = buildFlowHeight(data, stageLabels);

  return (
    <section className="course-map-shell">
      <header className="course-map-header">
        <div>
          <p className="course-map-eyebrow">已校对课程地图</p>
          <h3>{data.title}</h3>
          <p className="course-map-meta">
            来源页 {data.pageNumber} · 节点 {data.nodes.length} · 先修关系 {data.edges.length}
          </p>
        </div>
      </header>

      <section className="course-map-graph-panel">
        <div className="course-map-graph-copy">
          <h4>课程关系图</h4>
          <p>按学期分列展示课程节点，点击图中的课程可以查看它的前置与后续关系。</p>
        </div>
        <div className="course-map-stage-legend" aria-label="课程阶段图例">
          {stageLabels.map((stageLabel) => (
            <span key={stageLabel}>{stageLabel}</span>
          ))}
        </div>
        <div className="course-map-flow-shell" style={{ height: `${flowHeight}px` }}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            fitViewOptions={{ padding: 0.14 }}
            minZoom={0.4}
            maxZoom={1.5}
            onNodeClick={(_, node) => setActiveNodeKey(node.id)}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.className?.includes("selected") ? "#2f7a56" : "#b9d5c5"
              }
            />
            <Controls showInteractive={false} />
            <Background gap={18} size={1} color="#e1eee7" />
          </ReactFlow>
        </div>
      </section>

      <div className="course-map-grid">
        {stageLabels.map((stageLabel) => {
          const nodes = data.nodes.filter((node) => node.stage_label === stageLabel);
          if (!nodes.length) {
            return null;
          }
          return (
            <section key={stageLabel} className="course-map-stage">
              <h4>{stageLabel}</h4>
              <div className="course-map-node-list">
                {nodes.map((node) => {
                  const nodeKey = buildNodeKey(node);
                  const selected = nodeKey === activeNodeKey;
                  return (
                    <button
                      key={nodeKey}
                      className={selected ? "course-map-node selected" : "course-map-node"}
                      type="button"
                      onClick={() => setActiveNodeKey(nodeKey)}
                    >
                      {node.node_label}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {activeNode ? (
        <section className="course-map-detail">
          <div className="course-map-detail-header">
            <h4>{activeNode.node_label}</h4>
            <span>{activeNode.stage_label}</span>
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

export default function CourseMapSection(props: Props) {
  return (
    <ReactFlowProvider>
      <CourseMapSectionContent {...props} />
    </ReactFlowProvider>
  );
}
