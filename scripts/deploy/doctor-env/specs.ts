export type Env = Record<string, string | undefined>;
type SettingSpec = Record<string, readonly string[]>;
type FileSpec = Record<
	string,
	{ optional_keys?: readonly string[]; required_keys?: readonly string[] }
>;

export interface SurfaceSpec {
	files: FileSpec;
	optional_settings: SettingSpec;
	providers: Record<string, { checked_keys: readonly string[]; surface_name: string }>;
	required_settings: SettingSpec;
}

const llmApiKeyPrecedence = ["EVAL_LLM_API_KEY", "LLM_API_KEY"] as const;
const embeddingApiKeyPrecedence = ["EVAL_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"] as const;

const workerStagingSurfaceSpecs = {
	"worker-staging-app-api": {
		providers: {},
		required_settings: {
			cloudflare_account_id: ["CLOUDFLARE_ACCOUNT_ID"],
			cloudflare_api_token: ["CLOUDFLARE_API_TOKEN"],
			sentry_app_api_project_slug: ["SENTRY_APP_API_PROJECT_SLUG"],
			sentry_auth_token: ["SENTRY_AUTH_TOKEN"],
			sentry_org_slug: ["SENTRY_ORG_SLUG"],
			staging_app_api_sentry_dsn: ["STAGING_APP_API_SENTRY_DSN"],
			staging_app_api_db_fresh_hyperdrive_id: ["STAGING_APP_API_DB_FRESH_HYPERDRIVE_ID"],
			staging_app_api_db_hyperdrive_id: ["STAGING_APP_API_DB_HYPERDRIVE_ID"],
			staging_execution_control_vpc_service_id: ["STAGING_EXECUTION_CONTROL_VPC_SERVICE_ID"],
		},
		optional_settings: {
			staging_app_api_database_sslmode: ["STAGING_APP_API_DATABASE_SSLMODE"],
		},
		files: {},
	},
	"worker-staging-campus-web": {
		providers: {},
		required_settings: {
			cloudflare_account_id: ["CLOUDFLARE_ACCOUNT_ID"],
			cloudflare_api_token: ["CLOUDFLARE_API_TOKEN"],
			object_store_bucket_derived: ["OBJECT_STORE_BUCKET_DERIVED"],
			object_store_derived_access_key: ["OBJECT_STORE_DERIVED_ACCESS_KEY"],
			object_store_derived_secret_key: ["OBJECT_STORE_DERIVED_SECRET_KEY"],
			object_store_endpoint: ["OBJECT_STORE_ENDPOINT"],
			object_store_region: ["OBJECT_STORE_REGION"],
			sentry_auth_token: ["SENTRY_AUTH_TOKEN"],
			sentry_campus_web_project_slug: ["SENTRY_CAMPUS_WEB_PROJECT_SLUG"],
			sentry_org_slug: ["SENTRY_ORG_SLUG"],
			staging_campus_auth_turnstile_site_key: ["STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY"],
			staging_campus_web_browser_sentry_dsn: ["STAGING_CAMPUS_WEB_BROWSER_SENTRY_DSN"],
			staging_campus_web_edge_sentry_dsn: ["STAGING_CAMPUS_WEB_EDGE_SENTRY_DSN"],
			staging_map_data_bucket_name: ["STAGING_MAP_DATA_BUCKET_NAME"],
		},
		optional_settings: {},
		files: {},
	},
} satisfies Record<string, SurfaceSpec>;

const surfaceSpecDefinitions = {
	"worker-observability-local": {
		providers: {},
		required_settings: {},
		optional_settings: {},
		files: {
			"apps/app-api/.dev.vars": {
				required_keys: ["SENTRY_DSN", "SENTRY_ENVIRONMENT", "SENTRY_RELEASE"],
			},
			"apps/campus-web/.dev.vars": {
				required_keys: ["SENTRY_BROWSER_DSN", "SENTRY_DSN", "SENTRY_ENVIRONMENT", "SENTRY_RELEASE"],
			},
		},
	},
	ingestion: {
		providers: {
			embedding: {
				checked_keys: embeddingApiKeyPrecedence,
				surface_name: "ingestion.worker",
			},
		},
		required_settings: {
			object_store_endpoint: ["OBJECT_STORE_ENDPOINT"],
			object_store_credentials: [],
			registry_database_url: [
				"RAW_ASSET_REGISTRY_DATABASE_URL",
				"DOCUMENT_REGISTRY_DATABASE_URL",
				"CAMPUS_SHARED_POSTGRES_URL",
			],
		},
		optional_settings: {
			object_store_bucket_source: ["OBJECT_STORE_BUCKET_SOURCE"],
			object_store_bucket_derived: ["OBJECT_STORE_BUCKET_DERIVED"],
		},
		files: {},
	},
	query: {
		providers: {
			llm: { checked_keys: llmApiKeyPrecedence, surface_name: "query.runtime" },
			embedding: { checked_keys: embeddingApiKeyPrecedence, surface_name: "query.runtime" },
		},
		required_settings: {
			shared_postgres_url: ["CAMPUS_SHARED_POSTGRES_URL"],
		},
		optional_settings: {
			document_registry_database_url: [
				"DOCUMENT_REGISTRY_DATABASE_URL",
				"CAMPUS_SHARED_POSTGRES_URL",
			],
		},
		files: {
			"apps/app-api/.env": {
				required_keys: [
					"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
					"APP_API_SCHEMA_DATABASE_URL",
				],
				optional_keys: ["CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH"],
			},
			"apps/app-api/.dev.vars": {
				required_keys: [
					"BETTER_AUTH_SECRET",
					"AUTH_SHELL_ORIGIN",
					"EXECUTION_CONTROL_BASE_URL",
					"EXECUTION_CONTROL_SHARED_SECRET",
					"APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
					"APP_API_PRODUCT_CALLBACK_SHARED_SECRET",
				],
				optional_keys: ["SENTRY_DSN"],
			},
		},
	},
	"execution-control": {
		providers: {},
		required_settings: {
			runtime_config_path: ["EXECUTION_CONTROL_RUNTIME_CONFIG_PATH"],
			execution_control_shared_secret: ["EXECUTION_CONTROL_SHARED_SECRET"],
			internal_query_shared_secret: ["EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET"],
			metrics_bearer_token: ["EXECUTION_CONTROL_METRICS_BEARER_TOKEN"],
			run_projection_database_url: ["EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"],
			temporal_address: ["EXECUTION_CONTROL_TEMPORAL_ADDRESS"],
			temporal_namespace: ["EXECUTION_CONTROL_TEMPORAL_NAMESPACE"],
			temporal_task_queue: ["EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE"],
			temporal_worker_identity: ["EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"],
			temporal_workflow_worker_identity: ["EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY"],
			temporal_core_worker_identity: ["EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY"],
			temporal_agent_worker_identity: ["EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY"],
			temporal_start_timeout_ms: ["EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS"],
		},
		optional_settings: {
			agent_runtime_base_url: ["EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"],
			agent_runtime_shared_secret: ["EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET"],
			audit_log_path: ["AUDIT_LOG_PATH"],
			audit_queue_capacity: ["AUDIT_QUEUE_CAPACITY"],
		},
		files: {},
	},
	...workerStagingSurfaceSpecs,
} satisfies Record<string, SurfaceSpec>;

export const surfaceSpecs: Record<keyof typeof surfaceSpecDefinitions, SurfaceSpec> =
	surfaceSpecDefinitions;

export type Surface = keyof typeof surfaceSpecDefinitions;
