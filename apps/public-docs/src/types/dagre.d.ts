declare module "dagre" {
	interface GraphLabel {
		marginx?: number;
		marginy?: number;
		nodesep?: number;
		rankdir?: "TB" | "BT" | "LR" | "RL";
		ranksep?: number;
	}

	interface GraphNodeLabel {
		height?: number;
		width?: number;
		x: number;
		y: number;
	}

	class Graph {
		node(id: string): GraphNodeLabel;
		setDefaultEdgeLabel(callback: () => Record<string, unknown>): void;
		setEdge(sourceId: string, targetId: string): void;
		setGraph(label: GraphLabel): void;
		setNode(id: string, label: Pick<GraphNodeLabel, "height" | "width">): void;
	}

	const dagre: {
		graphlib: {
			Graph: typeof Graph;
		};
		layout(graph: Graph): void;
	};

	export default dagre;
}
