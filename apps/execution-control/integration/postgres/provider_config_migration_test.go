//go:build postgres_integration

package postgres_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/schemamigrations"
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

const currentProviderConfigSchemaSQL = `
create schema if not exists execution_config;
create table execution_config.model_settings (
	kind text primary key check (kind in ('llm','embedding')),
	provider text not null,
	base_url text not null,
	model text not null,
	transport text not null,
	dimensions integer,
	secret_key_id text not null,
	secret_nonce bytea not null,
	secret_ciphertext bytea not null,
	secret_fingerprint text not null,
	secret_last4 text not null,
	validation_status text not null check (validation_status in ('passed','failed')),
	validation_error_code text not null default '',
	validation_message text not null default '',
	validation_observed_dimensions integer,
	validated_at timestamptz not null,
	validated_by text not null,
	updated_at timestamptz not null,
	updated_by text not null
);
`

const appliedV7ProviderConfigSchemaSQL = `
create schema execution_control;
create schema execution_config;
create table execution_control.model_settings (
	kind text primary key check (kind in ('llm','embedding','notice_classifier')),
	provider text not null,
	base_url text not null,
	model text not null,
	transport text not null,
	secret_key_id text not null,
	secret_nonce bytea not null,
	secret_ciphertext bytea not null,
	secret_fingerprint text not null,
	secret_last4 text not null,
	validation_status text not null check (validation_status in ('passed','failed')),
	validation_error_code text not null default '',
	validation_message text not null default '',
	validation_observed_dimensions integer,
	validated_at timestamptz not null,
	validated_by text not null,
	updated_at timestamptz not null,
	updated_by text not null
);
create view execution_config.model_settings as
select kind,provider,base_url,model,transport,secret_key_id,secret_nonce,secret_ciphertext,
	secret_fingerprint,secret_last4,validation_status,validation_error_code,validation_message,
	validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by
from execution_control.model_settings offset 0;
create schema campus_docs_serving;
create table campus_docs_serving.current_index (
	singleton boolean primary key default true check (singleton),
	collection text not null check (collection ~ '^campus_docs_[a-f0-9]{64}$'),
	dense_vector_name text not null,
	embedding_dimensions integer not null check (embedding_dimensions > 0),
	embedding_query_instruction text not null,
	embedding_space_id text not null,
	sparse_model text not null,
	sparse_vector_name text not null
);
create table public.execution_control_migrations (
	id integer primary key generated by default as identity,
	version_id bigint not null,
	is_applied boolean not null,
	tstamp timestamp not null default now()
);
insert into public.execution_control_migrations (version_id, is_applied)
values (0, true), (1, true), (2, true), (3, true), (4, true), (5, true), (6, true), (7, true);
`

const retiredCampusDocsPublisherRole = "campus_docs_index_publisher"

func testLegacyProviderConfigMigration(t *testing.T, harness *postgresHarness) {
	t.Run("v8 re-encrypts every current setting and removes legacy columns", func(t *testing.T) {
		_, ownerURL := harness.ownerDatabase(t)
		conn := connect(t, ownerURL)
		if _, err := conn.Exec(t.Context(), appliedV7ProviderConfigSchemaSQL); err != nil {
			closeConn(t, conn)
			t.Fatalf("install applied v7 provider config fixture: %v", err)
		}
		closeConn(t, conn)
		installRetiredCampusDocsPublisherGrant(t, harness, ownerURL)
		keyring := loadIntegrationKeyring(t)
		for _, item := range []struct {
			kind  providerconfig.Kind
			model string
		}{
			{kind: providerconfig.KindLLM, model: "legacy-llm"},
			{kind: providerconfig.KindEmbedding, model: providerconfig.CanonicalEmbeddingModel},
			{kind: providerconfig.KindNoticeClassifier, model: "legacy-classifier"},
		} {
			insertCurrentModelSetting(t, ownerURL, keyring, "execution_control.model_settings", item.kind, item.model)
		}
		migrator, err := schemamigrations.New(ownerURL, keyring, integrationProviderCipher())
		if err != nil {
			t.Fatalf("create v8 migrator: %v", err)
		}
		if err := migrator.Up(t.Context()); err != nil {
			_ = migrator.Close()
			t.Fatalf("apply v8 re-encryption: %v", err)
		}
		_ = migrator.Close()
		assertRetiredCampusDocsPublisherPrivilegesRevoked(t, ownerURL)

		assertRetiredProviderSecretColumnsAbsent(t, ownerURL)
		store := newProviderStore(t, ownerURL, nil)
		for _, kind := range []providerconfig.Kind{
			providerconfig.KindLLM,
			providerconfig.KindEmbedding,
			providerconfig.KindNoticeClassifier,
		} {
			setting, err := store.Resolve(t.Context(), kind)
			if err != nil {
				t.Fatalf("resolve re-encrypted %s: %v", kind, err)
			}
			if setting.APIKey != "legacy-provider-secret" {
				t.Fatalf("re-encrypted %s api key = %q", kind, setting.APIKey)
			}
		}
	})

	t.Run("v8 rolls back on wrong key or corrupt ciphertext", func(t *testing.T) {
		for _, test := range []struct {
			name     string
			corrupt  bool
			wrongKey bool
		}{
			{name: "wrong key", wrongKey: true},
			{name: "corrupt ciphertext", corrupt: true},
		} {
			t.Run(test.name, func(t *testing.T) {
				_, ownerURL := harness.ownerDatabase(t)
				conn := connect(t, ownerURL)
				if _, err := conn.Exec(t.Context(), appliedV7ProviderConfigSchemaSQL); err != nil {
					closeConn(t, conn)
					t.Fatalf("install applied v7 provider config fixture: %v", err)
				}
				closeConn(t, conn)
				keyring := loadIntegrationKeyring(t)
				insertCurrentModelSetting(t, ownerURL, keyring, "execution_control.model_settings", providerconfig.KindLLM, "legacy-llm")
				if test.corrupt {
					conn = connect(t, ownerURL)
					if _, err := conn.Exec(t.Context(), "update execution_control.model_settings set secret_ciphertext='corrupt'::bytea where kind='llm'"); err != nil {
						closeConn(t, conn)
						t.Fatalf("corrupt provider ciphertext: %v", err)
					}
					closeConn(t, conn)
				}
				migrationKeyring := keyring
				if test.wrongKey {
					migrationKeyring = loadIntegrationKeyringWithOffset(t, 7)
				}
				migrator, err := schemamigrations.New(ownerURL, migrationKeyring, integrationProviderCipher())
				if err != nil {
					t.Fatalf("create rollback migrator: %v", err)
				}
				err = migrator.Up(t.Context())
				_ = migrator.Close()
				if err == nil {
					t.Fatal("invalid provider ciphertext unexpectedly migrated")
				}
				assertLegacyProviderColumnsPresent(t, ownerURL)
				assertMigrationVersionAbsent(t, ownerURL, 8)
			})
		}
	})

	t.Run("empty historical Goose chain is idempotent before cutover", func(t *testing.T) {
		_, ownerURL := harness.ownerDatabase(t)
		if err := migrateSchema(t.Context(), ownerURL, nil); err != nil {
			t.Fatalf("install empty historical schema: %v", err)
		}
		assertLegacyTablesAbsent(t, ownerURL)
		assertModelSettingsCount(t, ownerURL, "execution_control.model_settings", 0)
		if err := migrateSchema(t.Context(), ownerURL, nil); err != nil {
			t.Fatalf("repeat empty historical schema install: %v", err)
		}
		assertModelSettingsCount(t, ownerURL, "execution_control.model_settings", 0)
	})

	t.Run("successful install migrates settings and removes legacy schema", func(t *testing.T) {
		_, ownerURL := installLegacyProviderFixture(t, harness, legacyFixtureOptions{})
		keyring := loadIntegrationKeyring(t)
		if err := migrateSchema(t.Context(), ownerURL, keyring); err != nil {
			t.Fatalf("migrate legacy schema: %v", err)
		}
		assertLegacyTablesAbsent(t, ownerURL)
		assertModelSettingsCount(t, ownerURL, "execution_control.model_settings", 2)

		store := newProviderStore(t, ownerURL, keyring)
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
		if embedding.APIKey != "legacy-provider-secret" || embedding.Model != "Qwen3-Embedding-4B" || embedding.Transport != "embeddings" {
			t.Fatalf("migrated embedding = %#v", embedding)
		}
		if err := migrateSchema(t.Context(), ownerURL, nil); err != nil {
			t.Fatalf("repeat historical schema install: %v", err)
		}
		assertModelSettingsCount(t, ownerURL, "execution_control.model_settings", 2)
	})

	t.Run("current and legacy settings cannot coexist", func(t *testing.T) {
		_, ownerURL := harness.ownerDatabase(t)
		keyring := loadIntegrationKeyring(t)
		conn := connect(t, ownerURL)
		if _, err := conn.Exec(t.Context(), currentProviderConfigSchemaSQL); err != nil {
			closeConn(t, conn)
			t.Fatalf("install current schema fixture: %v", err)
		}
		closeConn(t, conn)
		insertCurrentModelSetting(t, ownerURL, keyring, "execution_config.model_settings", providerconfig.KindLLM, "conflicting-llm")
		conn = connect(t, ownerURL)
		if _, err := conn.Exec(t.Context(), legacyProviderConfigSchemaSQL); err != nil {
			closeConn(t, conn)
			t.Fatalf("install coexisting legacy schema: %v", err)
		}
		closeConn(t, conn)
		if err := migrateSchema(t.Context(), ownerURL, keyring); err == nil {
			t.Fatal("coexisting current and legacy settings unexpectedly migrated")
		}
		assertLegacyTablesPresent(t, ownerURL)
		assertModelSettingsCount(t, ownerURL, "execution_config.model_settings", 1)
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
				if err := migrateSchema(t.Context(), ownerURL, loadIntegrationKeyring(t)); err == nil {
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
		if err := migrateSchema(t.Context(), ownerURL, loadIntegrationKeyring(t)); err == nil {
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
		if err := migrateSchema(t.Context(), ownerURL, loadIntegrationKeyring(t)); err == nil {
			t.Fatal("partial schema unexpectedly migrated")
		}
		assertTablePresent(t, ownerURL, "execution_config.active_bundle")
		assertTableAbsent(t, ownerURL, "execution_config.model_settings")
	})

	t.Run("partial current schema fails before recording the provider migration", func(t *testing.T) {
		_, ownerURL := harness.ownerDatabase(t)
		conn := connect(t, ownerURL)
		if _, err := conn.Exec(t.Context(), `
			create schema execution_config;
			create table execution_config.model_settings (kind text primary key)
		`); err != nil {
			closeConn(t, conn)
			t.Fatalf("install partial current schema: %v", err)
		}
		closeConn(t, conn)
		if err := migrateSchema(t.Context(), ownerURL, nil); err == nil {
			t.Fatal("partial current schema unexpectedly migrated")
		}
		assertTablePresent(t, ownerURL, "execution_config.model_settings")
		conn = connect(t, ownerURL)
		defer closeConn(t, conn)
		var applied int
		if err := conn.QueryRow(t.Context(), `
			select count(*)::int
			from public.execution_control_migrations
			where version_id = 3 and is_applied
		`).Scan(&applied); err != nil {
			t.Fatalf("inspect provider migration ledger: %v", err)
		}
		if applied != 0 {
			t.Fatalf("provider migration ledger count = %d, want 0", applied)
		}
	})
}

func installRetiredCampusDocsPublisherGrant(t *testing.T, harness *postgresHarness, ownerURL string) {
	t.Helper()
	admin := connect(t, harness.adminURL)
	if _, err := admin.Exec(t.Context(), "create role "+pgx.Identifier{retiredCampusDocsPublisherRole}.Sanitize()+" nologin"); err != nil {
		closeConn(t, admin)
		t.Fatalf("create retired Campus docs publisher role: %v", err)
	}
	closeConn(t, admin)

	owner := connect(t, ownerURL)
	if _, err := owner.Exec(t.Context(), fmt.Sprintf(`
		grant usage on schema campus_docs_serving to %s;
		grant select, insert, update on table campus_docs_serving.current_index to %s;
	`,
		pgx.Identifier{retiredCampusDocsPublisherRole}.Sanitize(),
		pgx.Identifier{retiredCampusDocsPublisherRole}.Sanitize(),
	)); err != nil {
		closeConn(t, owner)
		t.Fatalf("grant retired Campus docs publisher privileges: %v", err)
	}
	closeConn(t, owner)

	adminDatabaseURL := databaseURLForOwner(t, harness, ownerURL, adminUser, adminPassword)
	t.Cleanup(func() {
		databaseConn, err := pgx.Connect(context.Background(), adminDatabaseURL)
		if err != nil {
			t.Errorf("connect to remove retired Campus docs publisher privileges: %v", err)
			return
		}
		if _, err := databaseConn.Exec(context.Background(), "drop owned by "+pgx.Identifier{retiredCampusDocsPublisherRole}.Sanitize()); err != nil {
			t.Errorf("remove retired Campus docs publisher database privileges: %v", err)
		}
		closeConn(t, databaseConn)

		clusterConn, err := pgx.Connect(context.Background(), harness.adminURL)
		if err != nil {
			t.Errorf("connect to remove retired Campus docs publisher role: %v", err)
			return
		}
		if _, err := clusterConn.Exec(context.Background(), "drop role "+pgx.Identifier{retiredCampusDocsPublisherRole}.Sanitize()); err != nil {
			t.Errorf("remove retired Campus docs publisher role: %v", err)
		}
		closeConn(t, clusterConn)
	})
}

func assertRetiredCampusDocsPublisherPrivilegesRevoked(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var usage bool
	if err := conn.QueryRow(
		t.Context(),
		"select has_schema_privilege($1, 'campus_docs_serving', 'USAGE')",
		retiredCampusDocsPublisherRole,
	).Scan(&usage); err != nil {
		t.Fatalf("inspect retired Campus docs publisher schema privilege: %v", err)
	}
	if usage {
		t.Fatal("retired Campus docs publisher retains campus_docs_serving schema usage")
	}
	for _, privilege := range []string{"SELECT", "INSERT", "UPDATE"} {
		assertRoleTablePrivilege(t, databaseURL, retiredCampusDocsPublisherRole, "campus_docs_serving.current_index", privilege, false)
	}
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

func insertCurrentModelSetting(
	t *testing.T,
	databaseURL string,
	keyring *providerconfig.Keyring,
	table string,
	kind providerconfig.Kind,
	model string,
) {
	t.Helper()
	if table != "execution_config.model_settings" && table != "execution_control.model_settings" {
		t.Fatalf("unsupported model settings table %q", table)
	}
	secret, err := keyring.Encrypt("legacy-provider-secret", "execution_config.model_settings:"+string(kind))
	if err != nil {
		t.Fatalf("encrypt current model setting: %v", err)
	}
	observedDimensions := 0
	transport := "responses"
	if kind == providerconfig.KindEmbedding {
		observedDimensions = 2560
		transport = "embeddings"
	}
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var dimensionsColumnExists bool
	parts := strings.Split(table, ".")
	if err := conn.QueryRow(t.Context(), `select exists(
		select 1 from information_schema.columns
		where table_schema=$1 and table_name=$2 and column_name='dimensions'
	)`, parts[0], parts[1]).Scan(&dimensionsColumnExists); err != nil {
		t.Fatalf("inspect current model setting columns: %v", err)
	}
	if dimensionsColumnExists {
		if _, err := conn.Exec(t.Context(), `insert into `+table+`
		(kind,provider,base_url,model,transport,dimensions,secret_key_id,secret_nonce,secret_ciphertext,
		 secret_fingerprint,secret_last4,validation_status,validation_error_code,validation_message,
		 validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by)
		values($1,'openai-compatible','https://provider.integration.example/v1',$2,$3,nullif($4,0),$5,$6,$7,$8,$9,
		 'passed','','legacy validation',nullif($10,0),$11,'legacy-test',$11,'legacy-test')`,
			kind, model, transport, observedDimensions, secret.KeyID, secret.Nonce, secret.Ciphertext, secret.Fingerprint,
			secret.Last4, observedDimensions, time.Date(2026, 7, 1, 0, 30, 0, 0, time.UTC)); err != nil {
			t.Fatalf("insert current %s setting: %v", kind, err)
		}
		return
	}
	if _, err := conn.Exec(t.Context(), `insert into `+table+`
		(kind,provider,base_url,model,transport,secret_key_id,secret_nonce,secret_ciphertext,
		 secret_fingerprint,secret_last4,validation_status,validation_error_code,validation_message,
		 validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by)
		values($1,'openai-compatible','https://provider.integration.example/v1',$2,$3,$4,$5,$6,$7,$8,
		 'passed','','legacy validation',nullif($9,0),$10,'legacy-test',$10,'legacy-test')`,
		kind, model, transport, secret.KeyID, secret.Nonce, secret.Ciphertext, secret.Fingerprint,
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

func assertModelSettingsCount(t *testing.T, databaseURL, table string, want int) {
	t.Helper()
	if table != "execution_config.model_settings" && table != "execution_control.model_settings" {
		t.Fatalf("unsupported model settings table %q", table)
	}
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var count int
	if err := conn.QueryRow(t.Context(), "select count(*) from "+table).Scan(&count); err != nil {
		t.Fatalf("count model settings: %v", err)
	}
	if count != want {
		t.Fatalf("model settings count = %d, want %d", count, want)
	}
}

func assertRetiredProviderSecretColumnsAbsent(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var count int
	if err := conn.QueryRow(t.Context(), `
		select count(*)::int
		from information_schema.columns
		where table_schema='execution_control' and table_name='model_settings'
		  and column_name in ('secret_key_id','secret_fingerprint','secret_last4')
	`).Scan(&count); err != nil {
		t.Fatalf("inspect retired provider secret columns: %v", err)
	}
	if count != 0 {
		t.Fatalf("retired provider secret columns = %d, want 0", count)
	}
}

func assertLegacyProviderColumnsPresent(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var count int
	if err := conn.QueryRow(t.Context(), `
		select count(*)::int
		from information_schema.columns
		where table_schema='execution_control' and table_name='model_settings'
		  and column_name in ('secret_key_id','secret_fingerprint','secret_last4')
	`).Scan(&count); err != nil {
		t.Fatalf("inspect legacy provider secret columns: %v", err)
	}
	if count != 3 {
		t.Fatalf("legacy provider secret columns = %d, want 3", count)
	}
}

func assertMigrationVersionAbsent(t *testing.T, databaseURL string, version int) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var applied int
	if err := conn.QueryRow(t.Context(), `
		select count(*)::int
		from public.execution_control_migrations
		where version_id=$1 and is_applied
	`, version).Scan(&applied); err != nil {
		t.Fatalf("inspect migration version %d: %v", version, err)
	}
	if applied != 0 {
		t.Fatalf("migration version %d applied after rollback", version)
	}
}
