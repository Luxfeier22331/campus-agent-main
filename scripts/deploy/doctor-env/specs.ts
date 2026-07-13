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
	"worker-staging": {
		providers: {},
		required_settings: {
			staging_access_policy_aud: ["STAGING_ACCESS_POLICY_AUD"],
			staging_access_team_domain: ["STAGING_ACCESS_TEAM_DOMAIN"],
		},
		optional_settings: {
			staging_app_api_database_sslmode: ["STAGING_APP_API_DATABASE_SSLMODE"],
			staging_app_api_operator_database_url: ["STAGING_APP_API_OPERATOR_DATABASE_URL"],
			staging_sentry_release: ["STAGING_SENTRY_RELEASE"],
		},
		files: {},
	},
	"worker-staging-app-api": {
		providers: {},
		required_settings: {},
		optional_settings: {
			staging_app_api_database_sslmode: ["STAGING_APP_API_DATABASE_SSLMODE"],
			staging_app_api_operator_database_url: ["STAGING_APP_API_OPERATOR_DATABASE_URL"],
			staging_sentry_release: ["STAGING_SENTRY_RELEASE"],
		},
		files: {},
	},
	"worker-staging-campus-web": {
		providers: {},
		required_settings: {
			staging_campus_auth_turnstile_site_key: ["STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY"],
		},
		optional_settings: {
			staging_campus_auth_turnstile_appearance: ["STAGING_CAMPUS_AUTH_TURNSTILE_APPEARANCE"],
			staging_campus_auth_turnstile_execution: ["STAGING_CAMPUS_AUTH_TURNSTILE_EXECUTION"],
			staging_sentry_release: ["STAGING_SENTRY_RELEASE"],
		},
		files: {},
	},
	"worker-staging-operator-console-web": {
		providers: {},
		required_settings: {
			staging_access_policy_aud: ["STAGING_ACCESS_POLICY_AUD"],
			staging_access_team_domain: ["STAGING_ACCESS_TEAM_DOMAIN"],
		},
		optional_settings: {
			staging_sentry_release: ["STAGING_SENTRY_RELEASE"],
		},
		files: {},
	},
} satisfies Record<string, SurfaceSpec>;

const surfaceSpecDefinitions = {
	evals: {
		providers: {},
		required_settings: {},
		optional_settings: {},
		files: {},
	},
	"worker-observability-local": {
		providers: {},
		required_settings: {},
		optional_settings: {},
		files: {
			"apps/app-api/.dev.vars": {
				required_keys: [
					"SENTRY_DSN",
					"SENTRY_ENVIRONMENT",
					"SENTRY_RELEASE",
					"APP_API_OTEL_INGEST_ENDPOINT",
					"APP_API_OTEL_INGEST_SHARED_SECRET",
				],
			},
			"apps/campus-web/.dev.vars": {
				required_keys: ["SENTRY_DSN", "SENTRY_ENVIRONMENT", "SENTRY_RELEASE"],
			},
			"apps/operator-console-web/.dev.vars": {
				required_keys: ["SENTRY_DSN", "SENTRY_ENVIRONMENT", "SENTRY_RELEASE"],
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
			ocr_base_url: ["OCR_BASE_URL"],
			ocr_api_key: ["OCR_API_KEY"],
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
	"internal-notice-consumption": {
		providers: {},
		required_settings: {
			projection_database_url: [
				"NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
				"CAMPUS_SHARED_POSTGRES_URL",
				"DOCUMENT_REGISTRY_DATABASE_URL",
			],
			read_model_database_url: [
				"INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
				"NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
				"CAMPUS_SHARED_POSTGRES_URL",
			],
			admission_database_url: [
				"INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL",
				"NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
				"CAMPUS_SHARED_POSTGRES_URL",
			],
			attempt_database_url: [
				"INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL",
				"INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL",
				"NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
				"CAMPUS_SHARED_POSTGRES_URL",
			],
			multimodal_api_key: ["INTERNAL_NOTICE_MULTIMODAL_API_KEY"],
			multimodal_model: ["INTERNAL_NOTICE_MULTIMODAL_MODEL"],
		},
		optional_settings: {
			projection_operator_database_url: [
				"NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL",
				"CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
			],
			admission_operator_database_url: [
				"INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL",
				"NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL",
			],
			attempt_operator_database_url: [
				"INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL",
				"INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL",
			],
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
					"APP_API_OPERATOR_DATABASE_URL",
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
					"APP_API_OPERATOR_EMAIL_ALLOWLIST",
					"APP_API_INTERNAL_SHARED_SECRET",
				],
				optional_keys: [
					"APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN",
					"SENTRY_DSN",
					"APP_API_OTEL_INGEST_ENDPOINT",
					"APP_API_OTEL_INGEST_SHARED_SECRET",
				],
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
			agent_runtime_timeout_ms: ["EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS"],
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
