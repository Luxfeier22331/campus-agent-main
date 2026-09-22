export type LocalDevTarget =
	| "document-ocr"
	| "core"
	| "ops-web"
	| "notice-publisher"
	| "internal-portal-collection"
	| "notice-classifier"
	| "campus-docs-index-publisher"
	| "notice-pipeline-worker"
	| "notice-artifacts-worker"
	| "campus-rag-index-publisher"
	| "notice-index-publisher";

export type LocalDevCapability =
	| "qdrant"
	| "postgres"
	| "derived-bucket"
	| "source-bucket"
	| "docs-bucket"
	| "docs-source"
	| "temporal";

export type LocalDevEnvironmentProjection =
	| "document-ocr"
	| "core"
	| "model-config"
	| "ops-web"
	| "notice-publisher"
	| "internal-portal-collection"
	| "notice-classifier"
	| "campus-docs-index-publisher"
	| "notice-pipeline-worker"
	| "notice-artifacts-worker"
	| "campus-rag-index-publisher"
	| "notice-index-publisher";

export type LocalDevRuntimeDependency = "core" | "model-config" | "ops-web";

export type LocalModelConfigName =
	| "document_ocr"
	| "primary_agent"
	| "campus_docs_embedding"
	| "campus_docs_reranker"
	| "notice_classification";

export type LocalBootstrapStep =
	| "campus-agent-schema"
	| "model-config-seed"
	| "model-config-check"
	| "app-api-seed-local-test-user"
	| "notice-publisher-seed-local"
	| "temporal-namespace";

export interface LocalDevTargetPlan {
	readonly bootstrapSteps: readonly LocalBootstrapStep[];
	readonly capabilities: readonly LocalDevCapability[];
	readonly environmentProjections: readonly LocalDevEnvironmentProjection[];
	readonly modelConfigNames: readonly LocalModelConfigName[];
	readonly runtimeDependencies: readonly LocalDevRuntimeDependency[];
	readonly target: LocalDevTarget;
}

interface LocalDevTargetDefinition
	extends Omit<LocalDevTargetPlan, "environmentProjections" | "target"> {
	directEnvironmentProjections: readonly LocalDevEnvironmentProjection[];
	environmentDependencies: readonly LocalDevTarget[];
	target: LocalDevTarget;
}

const TARGET_DEFINITIONS: Record<LocalDevTarget, LocalDevTargetDefinition> = {
	"document-ocr": {
		bootstrapSteps: ["campus-agent-schema", "model-config-seed", "model-config-check"],
		capabilities: ["postgres", "source-bucket", "derived-bucket"],
		directEnvironmentProjections: ["model-config", "document-ocr"],
		environmentDependencies: [],
		modelConfigNames: ["document_ocr"],
		runtimeDependencies: ["model-config"],
		target: "document-ocr",
	},
	core: {
		bootstrapSteps: [
			"campus-agent-schema",
			"model-config-seed",
			"app-api-seed-local-test-user",
			"model-config-check",
			"temporal-namespace",
		],
		capabilities: ["postgres", "derived-bucket", "temporal", "qdrant"],
		directEnvironmentProjections: ["core"],
		environmentDependencies: [],
		modelConfigNames: ["primary_agent", "campus_docs_embedding", "campus_docs_reranker"],
		runtimeDependencies: [],
		target: "core",
	},
	"ops-web": {
		bootstrapSteps: [
			"campus-agent-schema",
			"model-config-seed",
			"app-api-seed-local-test-user",
			"model-config-check",
			"temporal-namespace",
		],
		capabilities: ["postgres", "derived-bucket", "source-bucket", "qdrant", "temporal"],
		directEnvironmentProjections: [
			"ops-web",
			"internal-portal-collection",
			"notice-classifier",
			"notice-publisher",
			"document-ocr",
		],
		environmentDependencies: ["core"],
		modelConfigNames: [
			"primary_agent",
			"campus_docs_embedding",
			"campus_docs_reranker",
			"notice_classification",
		],
		runtimeDependencies: ["core"],
		target: "ops-web",
	},
	"notice-publisher": {
		bootstrapSteps: ["campus-agent-schema", "notice-publisher-seed-local"],
		capabilities: ["postgres", "source-bucket", "derived-bucket"],
		directEnvironmentProjections: ["notice-publisher"],
		environmentDependencies: [],
		modelConfigNames: [],
		runtimeDependencies: [],
		target: "notice-publisher",
	},
	"internal-portal-collection": {
		bootstrapSteps: ["campus-agent-schema", "notice-publisher-seed-local"],
		capabilities: ["postgres", "source-bucket"],
		directEnvironmentProjections: ["ops-web", "internal-portal-collection"],
		environmentDependencies: [],
		modelConfigNames: [],
		runtimeDependencies: ["ops-web"],
		target: "internal-portal-collection",
	},
	"notice-classifier": {
		bootstrapSteps: [
			"campus-agent-schema",
			"model-config-seed",
			"notice-publisher-seed-local",
			"model-config-check",
		],
		capabilities: ["postgres"],
		directEnvironmentProjections: ["model-config", "notice-classifier"],
		environmentDependencies: [],
		modelConfigNames: ["notice_classification"],
		runtimeDependencies: ["model-config"],
		target: "notice-classifier",
	},
	"campus-docs-index-publisher": {
		bootstrapSteps: [],
		capabilities: ["postgres", "docs-bucket", "docs-source"],
		directEnvironmentProjections: ["campus-docs-index-publisher"],
		environmentDependencies: [],
		modelConfigNames: [],
		runtimeDependencies: [],
		target: "campus-docs-index-publisher",
	},
	"notice-pipeline-worker": {
		bootstrapSteps: [
			"campus-agent-schema",
			"model-config-seed",
			"model-config-check",
			"temporal-namespace",
		],
		capabilities: ["postgres", "source-bucket", "derived-bucket", "temporal"],
		directEnvironmentProjections: [
			"model-config",
			"internal-portal-collection",
			"notice-pipeline-worker",
		],
		environmentDependencies: [],
		modelConfigNames: ["notice_classification", "campus_docs_embedding"],
		runtimeDependencies: ["model-config"],
		target: "notice-pipeline-worker",
	},
	"notice-artifacts-worker": {
		bootstrapSteps: [
			"campus-agent-schema",
			"model-config-seed",
			"model-config-check",
			"temporal-namespace",
		],
		capabilities: ["postgres", "derived-bucket", "qdrant", "temporal"],
		directEnvironmentProjections: ["model-config", "notice-artifacts-worker"],
		environmentDependencies: [],
		modelConfigNames: ["campus_docs_embedding"],
		runtimeDependencies: ["model-config"],
		target: "notice-artifacts-worker",
	},
	"campus-rag-index-publisher": {
		bootstrapSteps: [],
		capabilities: ["postgres", "derived-bucket", "qdrant"],
		directEnvironmentProjections: ["campus-rag-index-publisher"],
		environmentDependencies: [],
		modelConfigNames: [],
		runtimeDependencies: [],
		target: "campus-rag-index-publisher",
	},
	"notice-index-publisher": {
		bootstrapSteps: ["campus-agent-schema"],
		capabilities: ["postgres"],
		directEnvironmentProjections: ["notice-index-publisher"],
		environmentDependencies: [],
		modelConfigNames: [],
		runtimeDependencies: [],
		target: "notice-index-publisher",
	},
};

export const LOCAL_DEV_TARGETS = Object.keys(TARGET_DEFINITIONS) as LocalDevTarget[];

export function resolveLocalDevTargetPlan(target: LocalDevTarget): LocalDevTargetPlan {
	const definition = TARGET_DEFINITIONS[target];
	if (!definition) {
		throw new Error(`Unknown local development target: ${target}`);
	}
	const projections: LocalDevEnvironmentProjection[] = [];
	const visited = new Set<LocalDevTarget>();
	const visit = (current: LocalDevTarget): void => {
		if (visited.has(current)) {
			return;
		}
		visited.add(current);
		const currentDefinition = TARGET_DEFINITIONS[current];
		for (const dependency of currentDefinition.environmentDependencies) {
			visit(dependency);
		}
		for (const projection of currentDefinition.directEnvironmentProjections) {
			if (!projections.includes(projection)) {
				projections.push(projection);
			}
		}
	};
	visit(target);
	return {
		bootstrapSteps: definition.bootstrapSteps,
		capabilities: definition.capabilities,
		environmentProjections: projections,
		modelConfigNames: definition.modelConfigNames,
		runtimeDependencies: definition.runtimeDependencies,
		target,
	};
}
