//go:build postgres_integration

package postgres_test

import (
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/jackc/pgx/v5"
)

const legacyProviderConfigSchemaSQL = `
create schema if not exists execution_config;

create table execution_config.connection_revisions (
	connection_id text not null,
	revision bigint not null,
	provider text not null,
	base_url text not null,
	features_json jsonb not null,
	feature_config_json jsonb not null default '{}'::jsonb,
	secret_key_id text not null,
	secret_nonce bytea not null,
	secret_ciphertext bytea not null,
	secret_fingerprint text not null,
	secret_last4 text not null,
	created_at timestamptz not null,
	created_by text not null,
	primary key (connection_id, revision)
);

create table execution_config.profiles (
	profile_id text primary key,
	role text not null check (role in ('primary_agent','rag_query_embedding','rag_reranker')),
	kind text not null check (kind in ('prompt','embedding','rerank')),
	connection_id text not null,
	connection_revision bigint not null,
	model text not null,
	transport text not null,
	dimensions integer,
	timeout_ms integer not null check (timeout_ms > 0),
	created_at timestamptz not null,
	created_by text not null,
	foreign key (connection_id, connection_revision)
		references execution_config.connection_revisions(connection_id, revision)
);

create table execution_config.profile_validations (
	validation_id text primary key,
	profile_id text not null references execution_config.profiles(profile_id),
	status text not null check (status in ('passed','failed')),
	error_code text not null default '',
	message text not null,
	observed_dimensions integer,
	validated_at timestamptz not null,
	validated_by text not null
);

create index provider_profile_validations_latest_idx
	on execution_config.profile_validations(profile_id, validated_at desc);

create table execution_config.activation_bundles (
	bundle_id text primary key,
	revision bigint not null unique,
	profiles_json jsonb not null,
	activated_at timestamptz not null,
	activated_by text not null
);

create table execution_config.active_bundle (
	singleton boolean primary key default true check (singleton),
	bundle_id text not null references execution_config.activation_bundles(bundle_id),
	revision bigint not null,
	updated_at timestamptz not null
);

create table execution_config.command_receipts (
	idempotency_key text primary key,
	operation text not null,
	request_sha256 text not null,
	status_code integer not null,
	response_json jsonb not null,
	created_at timestamptz not null
);

create table execution_config.audit_events (
	event_id text primary key,
	event_type text not null,
	actor_id text not null,
	target_id text not null,
	details_json jsonb not null default '{}'::jsonb,
	occurred_at timestamptz not null
);
`

func testLegacyProviderConfigMigration(t *testing.T, harness *postgresHarness) {
	t.Run("clean and partially configured current schemas are idempotent", func(t *testing.T) {
		_, ownerURL := harness.ownerDatabase(t)
		if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, nil); err != nil {
			t.Fatalf("install empty current schema: %v", err)
		}
		assertLegacyTablesAbsent(t, ownerURL)
		assertModelSettingsCount(t, ownerURL, 0)
		keyring := loadIntegrationKeyring(t)
		insertCurrentModelSetting(t, ownerURL, keyring, providerconfig.KindLLM, "current-llm")
		if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, nil); err != nil {
			t.Fatalf("repeat install with one current setting: %v", err)
		}
		assertModelSettingsCount(t, ownerURL, 1)
		if err := providerconfig.CheckDatabaseSchema(t.Context(), ownerURL); err != nil {
			t.Fatalf("check current schema: %v", err)
		}
	})

	t.Run("successful install migrates settings and removes legacy schema", func(t *testing.T) {
		_, ownerURL := installLegacyProviderFixture(t, harness, legacyFixtureOptions{})
		keyring := loadIntegrationKeyring(t)
		if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, keyring); err != nil {
			t.Fatalf("migrate legacy schema: %v", err)
		}
		assertLegacyTablesAbsent(t, ownerURL)
		assertModelSettingsCount(t, ownerURL, 2)

		runtimeURL := databaseURLForOwner(t, harness, ownerURL, executionRole, executionPassword)
		store := newProviderStore(t, runtimeURL, keyring)
		llm, err := store.Resolve(t.Context(), providerconfig.KindLLM)
		if err != nil {
			t.Fatalf("resolve migrated llm: %v", err)
		}
		if llm.APIKey != "legacy-provider-secret" || llm.Model != "legacy-llm" || llm.Transport != "responses" {
			t.Fatalf("migrated llm = %#v", llm)
		}
		embedding, err := store.Resolve(t.Context(), providerconfig.KindEmbedding)
		if err != nil {
			t.Fatalf("resolve migrated embedding: %v", err)
		}
		if embedding.APIKey != "legacy-provider-secret" || embedding.Dimensions != 2560 {
			t.Fatalf("migrated embedding = %#v", embedding)
		}
		if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, nil); err != nil {
			t.Fatalf("repeat current schema install: %v", err)
		}
		if err := providerconfig.CheckDatabaseSchema(t.Context(), ownerURL); err != nil {
			t.Fatalf("check migrated schema: %v", err)
		}
	})

	t.Run("current and legacy settings cannot coexist", func(t *testing.T) {
		_, ownerURL := installLegacyProviderFixture(t, harness, legacyFixtureOptions{})
		keyring := loadIntegrationKeyring(t)
		if err := providerconfig.EnsureDatabaseSchema(t.Context(), ownerURL); err != nil {
			t.Fatalf("install current schema: %v", err)
		}
		insertCurrentModelSetting(t, ownerURL, keyring, providerconfig.KindLLM, "conflicting-llm")
		if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, keyring); err == nil {
			t.Fatal("coexisting current and legacy settings unexpectedly migrated")
		}
		assertLegacyTablesPresent(t, ownerURL)
		assertModelSettingsCount(t, ownerURL, 1)
	})

	t.Run("invalid legacy data rolls back schema and data changes", func(t *testing.T) {
		tests := []struct {
			name    string
			options legacyFixtureOptions
		}{
			{name: "missing active bundle", options: legacyFixtureOptions{omitActiveBundle: true}},
			{name: "unvalidated profile", options: legacyFixtureOptions{validationStatus: "failed"}},
			{name: "corrupt ciphertext", options: legacyFixtureOptions{corruptCiphertext: true}},
			{name: "invalid target setting", options: legacyFixtureOptions{baseURL: "http://provider.integration.example/v1"}},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				_, ownerURL := installLegacyProviderFixture(t, harness, test.options)
				if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, loadIntegrationKeyring(t)); err == nil {
					t.Fatal("invalid legacy provider config unexpectedly migrated")
				}
				assertLegacyTablesPresent(t, ownerURL)
				assertTableAbsent(t, ownerURL, "execution_config.model_settings")
			})
		}
	})

	t.Run("unknown legacy dependency rolls back every change", func(t *testing.T) {
		_, ownerURL := installLegacyProviderFixture(t, harness, legacyFixtureOptions{})
		conn := connect(t, ownerURL)
		if _, err := conn.Exec(t.Context(), `create view execution_config.legacy_active_bundle_dependency as
			select singleton,bundle_id,revision,updated_at from execution_config.active_bundle`); err != nil {
			closeConn(t, conn)
			t.Fatalf("create unknown legacy dependency: %v", err)
		}
		closeConn(t, conn)
		if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, loadIntegrationKeyring(t)); err == nil {
			t.Fatal("migration with unknown dependency unexpectedly succeeded")
		}
		assertLegacyTablesPresent(t, ownerURL)
		assertTablePresent(t, ownerURL, "execution_config.legacy_active_bundle_dependency")
		assertTableAbsent(t, ownerURL, "execution_config.model_settings")
	})

	t.Run("partial legacy schema fails closed", func(t *testing.T) {
		_, ownerURL := harness.ownerDatabase(t)
		conn := connect(t, ownerURL)
		defer closeConn(t, conn)
		if _, err := conn.Exec(t.Context(), `create schema if not exists execution_config; create table execution_config.active_bundle (singleton boolean primary key)`); err != nil {
			t.Fatalf("install partial schema: %v", err)
		}
		if err := providerconfig.InstallDatabaseSchema(t.Context(), ownerURL, loadIntegrationKeyring(t)); err == nil {
			t.Fatal("partial schema unexpectedly migrated")
		}
		assertTablePresent(t, ownerURL, "execution_config.active_bundle")
		assertTableAbsent(t, ownerURL, "execution_config.model_settings")
	})
}

type legacyFixtureOptions struct {
	baseURL           string
	corruptCiphertext bool
	omitActiveBundle  bool
	validationStatus  string
}

func installLegacyProviderFixture(t *testing.T, harness *postgresHarness, options legacyFixtureOptions) (string, string) {
	t.Helper()
	databaseName, ownerURL := harness.ownerDatabase(t)
	conn := connect(t, ownerURL)
	defer closeConn(t, conn)
	if _, err := conn.Exec(t.Context(), legacyProviderConfigSchemaSQL); err != nil {
		t.Fatalf("install legacy schema: %v", err)
	}
	keyring := loadIntegrationKeyring(t)
	secret, err := keyring.Encrypt("legacy-provider-secret", "execution_config.connection:legacy-connection:1")
	if err != nil {
		t.Fatalf("encrypt legacy secret: %v", err)
	}
	if options.corruptCiphertext {
		secret.Ciphertext = []byte("corrupt")
	}
	createdAt := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	activatedAt := createdAt.Add(time.Hour)
	baseURL := options.baseURL
	if baseURL == "" {
		baseURL = "https://provider.integration.example/v1"
	}
	if _, err := conn.Exec(t.Context(), `insert into execution_config.connection_revisions
		(connection_id,revision,provider,base_url,features_json,feature_config_json,secret_key_id,secret_nonce,secret_ciphertext,
		 secret_fingerprint,secret_last4,created_at,created_by)
		values($1,1,'openai-compatible',$2,'{}','{}',$3,$4,$5,$6,$7,$8,'legacy-test')`,
		"legacy-connection", baseURL, secret.KeyID, secret.Nonce, secret.Ciphertext, secret.Fingerprint, secret.Last4, createdAt); err != nil {
		t.Fatalf("insert legacy connection: %v", err)
	}
	if _, err := conn.Exec(t.Context(), `insert into execution_config.profiles
		(profile_id,role,kind,connection_id,connection_revision,model,transport,dimensions,timeout_ms,created_at,created_by)
		values
		('legacy-llm-profile','primary_agent','prompt','legacy-connection',1,'legacy-llm','responses',null,5000,$1,'legacy-test'),
		('legacy-embedding-profile','rag_query_embedding','embedding','legacy-connection',1,'Qwen3-Embedding-4B','embeddings',2560,5000,$1,'legacy-test')`, createdAt); err != nil {
		t.Fatalf("insert legacy profiles: %v", err)
	}
	validationStatus := options.validationStatus
	if validationStatus == "" {
		validationStatus = "passed"
	}
	if _, err := conn.Exec(t.Context(), `insert into execution_config.profile_validations
		(validation_id,profile_id,status,error_code,message,observed_dimensions,validated_at,validated_by)
		values
		('legacy-llm-validation','legacy-llm-profile',$1,'','legacy validation',null,$2,'legacy-test'),
		('legacy-embedding-validation','legacy-embedding-profile',$1,'','legacy validation',2560,$2,'legacy-test')`, validationStatus, createdAt.Add(30*time.Minute)); err != nil {
		t.Fatalf("insert legacy validations: %v", err)
	}
	if !options.omitActiveBundle {
		if _, err := conn.Exec(t.Context(), `insert into execution_config.activation_bundles
			(bundle_id,revision,profiles_json,activated_at,activated_by)
			values('legacy-bundle',1,'{"primary_agent":"legacy-llm-profile","rag_query_embedding":"legacy-embedding-profile"}',$1,'legacy-test')`, activatedAt); err != nil {
			t.Fatalf("insert legacy activation bundle: %v", err)
		}
		if _, err := conn.Exec(t.Context(), `insert into execution_config.active_bundle
			(singleton,bundle_id,revision,updated_at) values(true,'legacy-bundle',1,$1)`, activatedAt); err != nil {
			t.Fatalf("insert legacy active bundle: %v", err)
		}
	}
	return databaseName, ownerURL
}

func insertCurrentModelSetting(t *testing.T, databaseURL string, keyring *providerconfig.Keyring, kind providerconfig.Kind, model string) {
	t.Helper()
	secret, err := keyring.Encrypt("legacy-provider-secret", "execution_config.model_settings:"+string(kind))
	if err != nil {
		t.Fatalf("encrypt current model setting: %v", err)
	}
	dimensions := 0
	observedDimensions := 0
	transport := "responses"
	if kind == providerconfig.KindEmbedding {
		dimensions = 2560
		observedDimensions = 2560
		transport = "embeddings"
	}
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	if _, err := conn.Exec(t.Context(), `insert into execution_config.model_settings
		(kind,provider,base_url,model,transport,dimensions,secret_key_id,secret_nonce,secret_ciphertext,
		 secret_fingerprint,secret_last4,validation_status,validation_error_code,validation_message,
		 validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by)
		values($1,'openai-compatible','https://provider.integration.example/v1',$2,$3,nullif($4,0),$5,$6,$7,$8,$9,
		 'passed','','legacy validation',nullif($10,0),$11,'legacy-test',$11,'legacy-test')`,
		kind, model, transport, dimensions, secret.KeyID, secret.Nonce, secret.Ciphertext, secret.Fingerprint,
		secret.Last4, observedDimensions, time.Date(2026, 7, 1, 0, 30, 0, 0, time.UTC)); err != nil {
		t.Fatalf("insert current %s setting: %v", kind, err)
	}
}

func assertLegacyReaderCanRead(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var count int
	if err := conn.QueryRow(t.Context(), "select count(*) from execution_config.active_bundle").Scan(&count); err != nil {
		t.Fatalf("legacy reader cannot read active bundle: %v", err)
	}
	if count != 1 {
		t.Fatalf("legacy active bundle count = %d, want 1", count)
	}
}

func assertTableAbsent(t *testing.T, databaseURL, name string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var exists bool
	if err := conn.QueryRow(t.Context(), "select to_regclass($1) is not null", name).Scan(&exists); err != nil {
		t.Fatalf("check absent relation %s: %v", name, err)
	}
	if exists {
		t.Fatalf("relation %s unexpectedly exists", name)
	}
}

func assertTablePresent(t *testing.T, databaseURL, name string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var exists bool
	if err := conn.QueryRow(t.Context(), "select to_regclass($1) is not null", name).Scan(&exists); err != nil {
		t.Fatalf("check present relation %s: %v", name, err)
	}
	if !exists {
		t.Fatalf("relation %s is missing", name)
	}
}

func databaseURLForOwner(t *testing.T, harness *postgresHarness, ownerURL, role, password string) string {
	t.Helper()
	// The harness URL already points at the isolated database; reuse its parsed
	// database name through the standard harness helper.
	parsed, err := pgx.ParseConfig(ownerURL)
	if err != nil {
		t.Fatalf("parse owner database URL: %v", err)
	}
	return harness.databaseURL(t, parsed.Database, role, password)
}

func assertLegacyTablesPresent(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var count int
	if err := conn.QueryRow(t.Context(), `select count(*) from (values
		('execution_config.active_bundle'::text),('execution_config.activation_bundles'),
		('execution_config.profile_validations'),('execution_config.profiles'),
		('execution_config.connection_revisions'),('execution_config.command_receipts'),
		('execution_config.audit_events')) as expected(name)
		where to_regclass(name) is not null`).Scan(&count); err != nil {
		t.Fatalf("check legacy tables: %v", err)
	}
	if count != 7 {
		t.Fatalf("legacy table count = %d, want 7", count)
	}
}

func assertLegacyTablesAbsent(t *testing.T, databaseURL string) {
	t.Helper()
	for _, table := range []string{
		"execution_config.active_bundle",
		"execution_config.activation_bundles",
		"execution_config.profile_validations",
		"execution_config.profiles",
		"execution_config.connection_revisions",
		"execution_config.command_receipts",
		"execution_config.audit_events",
	} {
		assertTableAbsent(t, databaseURL, table)
	}
}

func assertRoleTablePrivilege(
	t *testing.T,
	databaseURL string,
	role string,
	table string,
	privilege string,
	want bool,
) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var granted bool
	if err := conn.QueryRow(t.Context(), "select has_table_privilege($1,$2,$3)", role, table, privilege).Scan(&granted); err != nil {
		t.Fatalf("check %s %s on %s: %v", role, privilege, table, err)
	}
	if granted != want {
		t.Fatalf("%s %s on %s = %t, want %t", role, privilege, table, granted, want)
	}
}

func assertModelSettingsCount(t *testing.T, databaseURL string, want int) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var count int
	if err := conn.QueryRow(t.Context(), "select count(*) from execution_config.model_settings").Scan(&count); err != nil {
		t.Fatalf("count model settings: %v", err)
	}
	if count != want {
		t.Fatalf("model settings count = %d, want %d", count, want)
	}
}
