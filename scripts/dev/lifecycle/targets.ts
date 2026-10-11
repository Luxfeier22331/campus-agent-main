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
	| "hindsight"
	| "qdrant"
	| "postgres"
	| "derived-bucket"
	| "source-bucket"
	| "docs-bucket"
	| "docs-source"
	| "temporal";

export type LocalDevEnvironmentProjection =
	| "app-api"
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

export type LocalDevRuntimeDependency = "core" | "model-config" | "ops-web" | "app-api";

export type LocalModelConfigName =
	| "document_ocr"
	| "primary_agent"
	| "campus_docs_embedding"
	| "campus_docs_reranker"
	| "notice_classification";

export type LocalBootstrapStep =
	| "memory-schema"
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

// Every target is a composition of consumer-owned requirements. Preparing a
// consumer does not recursively start its runtime dependencies.
interface Consumer {
	projections: readonly LocalDevEnvironmentProjection[];
	capabilities: readonly LocalDevCapability[];
	bootstrap?: readonly LocalBootstrapStep[];
	models?: readonly LocalModelConfigName[];
	runtime?: readonly LocalDevRuntimeDependency[];
}
const consumers = {
	appApi: {
		projections: ["app-api"],
		capabilities: ["postgres", "derived-bucket"],
		bootstrap: ["campus-agent-schema", "app-api-seed-local-test-user"],
		runtime: ["app-api"],
	},
	modelConfig: {
		projections: ["model-config"],
		capabilities: ["postgres"],
		bootstrap: ["campus-agent-schema"],
		runtime: ["model-config"],
	},
	ops: {
		projections: ["ops-web"],
		capabilities: ["postgres", "derived-bucket", "source-bucket", "temporal"],
		bootstrap: ["campus-agent-schema", "temporal-namespace"],
		runtime: ["ops-web"],
	},
	core: {
		projections: ["core"],
		capabilities: ["postgres", "derived-bucket", "source-bucket", "temporal", "qdrant"],
		bootstrap: [
			"campus-agent-schema",
			"memory-schema",
			"app-api-seed-local-test-user",
			"temporal-namespace",
		],
		models: ["primary_agent", "campus_docs_embedding", "campus_docs_reranker"],
		runtime: ["core"],
	},
	collection: {
		projections: ["internal-portal-collection"],
		capabilities: ["postgres", "source-bucket"],
		bootstrap: ["campus-agent-schema", "notice-publisher-seed-local"],
		runtime: ["ops-web"],
	},
	classifier: {
		projections: ["notice-classifier"],
		capabilities: ["postgres"],
		bootstrap: ["campus-agent-schema", "notice-publisher-seed-local"],
		models: ["notice_classification"],
	},
	ocr: {
		projections: ["document-ocr"],
		capabilities: ["postgres", "source-bucket", "derived-bucket"],
		bootstrap: ["campus-agent-schema"],
		models: ["document_ocr"],
	},
	publisher: {
		projections: ["notice-publisher"],
		capabilities: ["postgres", "source-bucket", "derived-bucket"],
		bootstrap: ["campus-agent-schema", "notice-publisher-seed-local"],
	},
	docs: {
		projections: ["campus-docs-index-publisher"],
		capabilities: ["derived-bucket"],
		bootstrap: [],
	},
	pipeline: {
		projections: ["notice-pipeline-worker"],
		capabilities: ["postgres", "source-bucket", "derived-bucket", "temporal"],
		bootstrap: ["campus-agent-schema", "notice-publisher-seed-local", "temporal-namespace"],
		models: ["notice_classification"],
	},
	artifacts: {
		projections: ["notice-artifacts-worker"],
		capabilities: ["postgres", "derived-bucket", "qdrant", "temporal"],
		bootstrap: ["campus-agent-schema", "temporal-namespace"],
		models: ["campus_docs_embedding"],
	},
	rag: {
		projections: ["campus-rag-index-publisher"],
		capabilities: ["postgres", "derived-bucket", "qdrant"],
		bootstrap: ["campus-agent-schema"],
	},
	noticeIndex: {
		projections: ["notice-index-publisher"],
		capabilities: ["postgres"],
		bootstrap: ["campus-agent-schema"],
	},
} satisfies Record<string, Consumer>;
const TARGET_CONSUMERS: Record<LocalDevTarget, readonly Consumer[]> = {
	core: [consumers.core],
	"ops-web": [consumers.appApi, consumers.modelConfig, consumers.ops],
	"document-ocr": [consumers.modelConfig, consumers.ocr],
	"internal-portal-collection": [consumers.ops, consumers.collection],
	"notice-classifier": [consumers.modelConfig, consumers.classifier],
	"notice-publisher": [consumers.publisher],
	"campus-docs-index-publisher": [consumers.docs],
	"notice-pipeline-worker": [
		consumers.modelConfig,
		consumers.ops,
		consumers.collection,
		consumers.pipeline,
	],
	"notice-artifacts-worker": [consumers.modelConfig, consumers.artifacts],
	"campus-rag-index-publisher": [consumers.rag],
	"notice-index-publisher": [consumers.noticeIndex],
};
export const LOCAL_DEV_TARGETS = Object.keys(TARGET_CONSUMERS) as LocalDevTarget[];
export function resolveLocalDevTargetPlan(target: LocalDevTarget): LocalDevTargetPlan {
	const definitions = TARGET_CONSUMERS[target];
	if (!definitions) {
		throw new Error(`Unknown local development target: ${target}`);
	}
	const unique = <T>(values: T[]) => [...new Set(values)];
	return {
		target,
		environmentProjections: unique(definitions.flatMap((d) => [...d.projections])),
		capabilities: unique(definitions.flatMap((d) => [...d.capabilities])),
		bootstrapSteps: unique(definitions.flatMap((d) => [...(d.bootstrap ?? [])])),
		modelConfigNames: unique(definitions.flatMap((d) => [...(d.models ?? [])])),
		runtimeDependencies: unique(definitions.flatMap((d) => [...(d.runtime ?? [])])),
	};
}
