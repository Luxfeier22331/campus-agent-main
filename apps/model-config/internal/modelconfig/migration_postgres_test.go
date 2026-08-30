//go:build postgres_integration

package modelconfig

import (
	"context"
	"encoding/base64"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
)

const postgresImage = "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"

func TestPostgresMigration(t *testing.T) {
	ctx := t.Context()
	container, err := tcpostgres.Run(ctx, postgresImage, tcpostgres.WithDatabase("postgres"), tcpostgres.WithUsername("postgres"), tcpostgres.WithPassword("postgres-integration-admin"), tcpostgres.BasicWaitStrategies())
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start PostgreSQL: %v", err)
	}
	adminURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	admin := connectPostgres(t, adminURL)
	defer admin.Close(ctx)
	for _, statement := range []string{
		"create role campus_agent login password 'campus-agent-password'",
		"create role model_config login password 'model-config-password'",
	} {
		if _, err := admin.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("fresh install is idempotent and grants the runtime role", func(t *testing.T) {
		ownerURL := createDatabase(t, adminURL, "model_config_fresh")
		currentKey := writeKey(t, "01234567890123456789012345678901")
		if err := Install(ctx, ownerURL, currentKey, ""); err != nil {
			t.Fatal(err)
		}
		if err := Install(ctx, ownerURL, currentKey, ""); err != nil {
			t.Fatalf("second install: %v", err)
		}
		owner := connectPostgres(t, ownerURL)
		defer owner.Close(ctx)
		var versionCount int
		if err := owner.QueryRow(ctx, "select count(*) from model_config.schema_migrations where version=1").Scan(&versionCount); err != nil {
			t.Fatal(err)
		}
		if versionCount != 1 {
			t.Fatalf("migration rows = %d", versionCount)
		}
		for _, object := range []string{"model_config", "model_config.model_configs", "model_config.schema_migrations"} {
			var objectOwner string
			query := "select pg_get_userbyid(nspowner) from pg_namespace where nspname='model_config'"
			args := []any{}
			if object != "model_config" {
				query = "select pg_get_userbyid(relowner) from pg_class where oid=$1::regclass"
				args = append(args, object)
			}
			if err := owner.QueryRow(ctx, query, args...).Scan(&objectOwner); err != nil {
				t.Fatal(err)
			}
			if objectOwner != schemaOwnerRole {
				t.Fatalf("%s owner = %s, want %s", object, objectOwner, schemaOwnerRole)
			}
		}
		var runtimeUsage, runtimeCreate bool
		if err := owner.QueryRow(ctx, "select has_schema_privilege('model_config','model_config','USAGE'), has_schema_privilege('model_config','model_config','CREATE')").Scan(&runtimeUsage, &runtimeCreate); err != nil {
			t.Fatal(err)
		}
		if !runtimeUsage || runtimeCreate {
			t.Fatalf("runtime schema privileges usage=%t create=%t", runtimeUsage, runtimeCreate)
		}
		for _, privilege := range []string{"SELECT", "INSERT", "UPDATE"} {
			var granted bool
			if err := owner.QueryRow(ctx, "select has_table_privilege('model_config','model_config.model_configs',$1)", privilege).Scan(&granted); err != nil {
				t.Fatal(err)
			}
			if !granted {
				t.Fatalf("model_config lacks %s", privilege)
			}
		}
	})

	t.Run("legacy model setting migrates, decrypts, and drops the old owner", func(t *testing.T) {
		ownerURL := createDatabase(t, adminURL, "model_config_legacy")
		currentKey := writeKey(t, "01234567890123456789012345678901")
		legacyKey := writeKey(t, "abcdefghijklmnopqrstuvwxyzABCDEF")
		installLegacyModelSetting(t, ownerURL, legacyKey, "gpt-5-mini", false)
		if err := Install(ctx, ownerURL, currentKey, legacyKey); err != nil {
			t.Fatal(err)
		}
		assertLegacyTable(t, ownerURL, false)
		cipher, err := LoadCipher(currentKey)
		if err != nil {
			t.Fatal(err)
		}
		store, err := NewStore(ctx, runtimeURL(ownerURL), cipher)
		if err != nil {
			t.Fatal(err)
		}
		defer store.Close()
		resolved, err := store.Resolve(ctx, ConfigPrimaryAgent, "")
		if err != nil {
			t.Fatal(err)
		}
		if resolved.APIKey != "legacy-provider-secret" || resolved.Model != "gpt-5-mini" {
			t.Fatalf("resolved = %#v", resolved)
		}
		if err := store.Readiness(ctx); err != nil {
			t.Fatalf("readiness: %v", err)
		}
		owner := connectPostgres(t, ownerURL)
		var updatedAtBefore time.Time
		if err := owner.QueryRow(ctx, "select updated_at from model_config.model_configs where name='primary_agent'").Scan(&updatedAtBefore); err != nil {
			t.Fatal(err)
		}
		if _, err := store.RecordValidation(ctx, ConfigPrimaryAgent, "revalidator", Validation{
			Status:  "failed",
			Message: "provider validation failed",
		}); err != nil {
			t.Fatalf("record validation: %v", err)
		}
		var updatedAtAfter time.Time
		if err := owner.QueryRow(ctx, "select updated_at from model_config.model_configs where name='primary_agent'").Scan(&updatedAtAfter); err != nil {
			t.Fatal(err)
		}
		if !updatedAtAfter.Equal(updatedAtBefore) {
			t.Fatalf("updated_at changed from %s to %s", updatedAtBefore, updatedAtAfter)
		}
		if _, err := owner.Exec(ctx, "update model_config.model_configs set encrypted_api_key='corrupt'::bytea where name='primary_agent'"); err != nil {
			t.Fatal(err)
		}
		owner.Close(ctx)
		if err := store.Readiness(ctx); err == nil {
			t.Fatal("readiness accepted undecryptable secret")
		}
	})

	t.Run("rejects schema drift instead of repairing it implicitly", func(t *testing.T) {
		tests := []struct {
			name      string
			database  string
			mutate    func(*testing.T, string)
			wantError string
		}{
			{
				name:     "unknown column",
				database: "model_config_drift_column",
				mutate: func(t *testing.T, databaseURL string) {
					conn := connectPostgres(t, databaseURL)
					defer conn.Close(t.Context())
					if _, err := conn.Exec(t.Context(), "alter table model_config.model_configs add column drift text"); err != nil {
						t.Fatal(err)
					}
				},
				wantError: "unexpected columns",
			},
			{
				name:     "unknown relation",
				database: "model_config_drift_relation",
				mutate: func(t *testing.T, databaseURL string) {
					conn := connectPostgres(t, databaseURL)
					defer conn.Close(t.Context())
					if _, err := conn.Exec(t.Context(), "create table model_config.drift(id integer)"); err != nil {
						t.Fatal(err)
					}
				},
				wantError: "unexpected relations",
			},
			{
				name:     "unknown constraint",
				database: "model_config_drift_constraint",
				mutate: func(t *testing.T, databaseURL string) {
					conn := connectPostgres(t, databaseURL)
					defer conn.Close(t.Context())
					if _, err := conn.Exec(t.Context(), "alter table model_config.model_configs drop constraint model_configs_name_check"); err != nil {
						t.Fatal(err)
					}
				},
				wantError: "unexpected constraints",
			},
			{
				name:     "unknown index",
				database: "model_config_drift_index",
				mutate: func(t *testing.T, databaseURL string) {
					conn := connectPostgres(t, databaseURL)
					defer conn.Close(t.Context())
					if _, err := conn.Exec(t.Context(), "create index model_configs_drift_idx on model_config.model_configs(provider)"); err != nil {
						t.Fatal(err)
					}
				},
				wantError: "unexpected indexes",
			},
			{
				name:     "extra runtime grant",
				database: "model_config_drift_grant",
				mutate: func(t *testing.T, databaseURL string) {
					conn := connectPostgres(t, databaseURL)
					defer conn.Close(t.Context())
					if _, err := conn.Exec(t.Context(), "grant delete on table model_config.model_configs to model_config"); err != nil {
						t.Fatal(err)
					}
				},
				wantError: "DELETE",
			},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				ownerURL := createDatabase(t, adminURL, test.database)
				key := writeKey(t, "01234567890123456789012345678901")
				if err := Install(ctx, ownerURL, key, ""); err != nil {
					t.Fatal(err)
				}
				test.mutate(t, ownerURL)
				if err := Install(ctx, ownerURL, key, ""); err == nil || !strings.Contains(err.Error(), test.wantError) {
					t.Fatalf("Install() error = %v, want substring %q", err, test.wantError)
				}
			})
		}
	})

	t.Run("rejects a table with the wrong owner", func(t *testing.T) {
		ownerURL := createDatabase(t, adminURL, "model_config_drift_owner")
		key := writeKey(t, "01234567890123456789012345678901")
		if err := Install(ctx, ownerURL, key, ""); err != nil {
			t.Fatal(err)
		}
		adminDatabaseURL := databaseURLForUser(t, adminURL, "model_config_drift_owner", "postgres", "postgres-integration-admin")
		adminDatabase := connectPostgres(t, adminDatabaseURL)
		if _, err := adminDatabase.Exec(ctx, "alter table model_config.model_configs owner to model_config"); err != nil {
			t.Fatal(err)
		}
		adminDatabase.Close(ctx)
		if err := Install(ctx, ownerURL, key, ""); err == nil || !strings.Contains(err.Error(), "owner/kind") {
			t.Fatalf("Install() error = %v, want owner drift", err)
		}
	})

	t.Run("conflicting target rolls back and preserves the legacy source", func(t *testing.T) {
		ownerURL := createDatabase(t, adminURL, "model_config_conflict")
		currentKey := writeKey(t, "01234567890123456789012345678901")
		legacyKey := writeKey(t, "abcdefghijklmnopqrstuvwxyzABCDEF")
		if err := Install(ctx, ownerURL, currentKey, ""); err != nil {
			t.Fatal(err)
		}
		insertCurrentConfig(t, ownerURL, currentKey, "existing-model")
		installLegacyModelSetting(t, ownerURL, legacyKey, "legacy-model", false)
		if err := Install(ctx, ownerURL, currentKey, legacyKey); err == nil || !strings.Contains(err.Error(), "conflicts") {
			t.Fatalf("error = %v", err)
		}
		assertLegacyTable(t, ownerURL, true)
	})

	t.Run("undecryptable legacy data rolls back", func(t *testing.T) {
		ownerURL := createDatabase(t, adminURL, "model_config_decrypt")
		currentKey := writeKey(t, "01234567890123456789012345678901")
		legacyKey := writeKey(t, "abcdefghijklmnopqrstuvwxyzABCDEF")
		installLegacyModelSetting(t, ownerURL, legacyKey, "gpt-5-mini", true)
		if err := Install(ctx, ownerURL, currentKey, legacyKey); err == nil {
			t.Fatal("migration accepted corrupt legacy ciphertext")
		}
		assertLegacyTable(t, ownerURL, true)
	})

	t.Run("invalid legacy target rolls back", func(t *testing.T) {
		ownerURL := createDatabase(t, adminURL, "model_config_invalid_target")
		currentKey := writeKey(t, "01234567890123456789012345678901")
		legacyKey := writeKey(t, "abcdefghijklmnopqrstuvwxyzABCDEF")
		installLegacyModelSetting(t, ownerURL, legacyKey, "gpt-5-mini", false)
		owner := connectPostgres(t, ownerURL)
		if _, err := owner.Exec(ctx, "update execution_control.model_settings set provider='unsupported' where kind='llm'"); err != nil {
			t.Fatal(err)
		}
		owner.Close(ctx)
		if err := Install(ctx, ownerURL, currentKey, legacyKey); err == nil || !strings.Contains(err.Error(), "legacy model setting llm is invalid") {
			t.Fatalf("Install() error = %v", err)
		}
		assertLegacyTable(t, ownerURL, true)
	})
}

func createDatabase(t *testing.T, adminURL, name string) string {
	t.Helper()
	conn := connectPostgres(t, adminURL)
	defer conn.Close(t.Context())
	if _, err := conn.Exec(t.Context(), "create database "+pgx.Identifier{name}.Sanitize()+" owner campus_agent"); err != nil {
		t.Fatal(err)
	}
	return databaseURLForUser(t, adminURL, name, "campus_agent", "campus-agent-password")
}

func databaseURLForUser(t *testing.T, baseURL, database, user, password string) string {
	t.Helper()
	parsed, err := url.Parse(baseURL)
	if err != nil {
		t.Fatal(err)
	}
	parsed.User = url.UserPassword(user, password)
	parsed.Path = "/" + database
	return parsed.String()
}

func runtimeURL(ownerURL string) string {
	parsed, _ := url.Parse(ownerURL)
	parsed.User = url.UserPassword("model_config", "model-config-password")
	return parsed.String()
}

func connectPostgres(t *testing.T, databaseURL string) *pgx.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func writeKey(t *testing.T, key string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "encryption.key")
	body := base64.StdEncoding.EncodeToString([]byte(key)) + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func installLegacyModelSetting(t *testing.T, databaseURL, keyPath, model string, corrupt bool) {
	t.Helper()
	conn := connectPostgres(t, databaseURL)
	defer conn.Close(t.Context())
	_, err := conn.Exec(t.Context(), `create schema execution_control;
create table execution_control.model_settings(
kind text primary key, provider text not null, base_url text not null, model text not null, transport text not null,
secret_nonce bytea not null, secret_ciphertext bytea not null, validation_status text not null,
validation_error_code text not null, validation_message text not null, validation_observed_dimensions integer,
validated_at timestamptz not null, validated_by text not null, updated_at timestamptz not null, updated_by text not null);
create schema execution_config;
create view execution_config.model_settings as select * from execution_control.model_settings`)
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := LoadCipher(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	nonce, ciphertext, err := cipher.Encrypt("legacy-provider-secret", "execution_config.model_settings:llm")
	if err != nil {
		t.Fatal(err)
	}
	if corrupt {
		ciphertext = []byte("corrupt")
	}
	_, err = conn.Exec(t.Context(), `insert into execution_control.model_settings values('llm','openai','https://api.openai.com/v1',$1,'responses',$2,$3,'passed','','validated',null,now(),'test',now(),'test')`, model, nonce, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
}

func insertCurrentConfig(t *testing.T, databaseURL, keyPath, model string) {
	t.Helper()
	cipher, err := LoadCipher(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cipher.EncryptValue("current-secret", configAAD(ConfigPrimaryAgent))
	if err != nil {
		t.Fatal(err)
	}
	conn := connectPostgres(t, databaseURL)
	defer conn.Close(t.Context())
	_, err = conn.Exec(t.Context(), `insert into model_config.model_configs(name,provider,api_protocol,base_url,model,encrypted_api_key,validation_status,validation_error_code,validation_message,validation_observed_dimensions,validated_at,validated_by,updated_at,updated_by) values('primary_agent','openai','openai.responses','https://api.openai.com/v1',$1,$2,'passed','','validated',null,now(),'test',now(),'test')`, model, encrypted)
	if err != nil {
		t.Fatal(err)
	}
}

func assertLegacyTable(t *testing.T, databaseURL string, want bool) {
	t.Helper()
	conn := connectPostgres(t, databaseURL)
	defer conn.Close(t.Context())
	var exists bool
	if err := conn.QueryRow(t.Context(), "select to_regclass('execution_control.model_settings') is not null").Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists != want {
		t.Fatalf("legacy table exists = %t, want %t", exists, want)
	}
}
