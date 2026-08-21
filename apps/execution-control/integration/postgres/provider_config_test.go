//go:build postgres_integration

package postgres_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/schemamigrations"
	"github.com/jackc/pgx/v5"
)

func testSchemaMigrationsWithoutGrantRoles(t *testing.T, harness *postgresHarness) {
	databaseName := harness.createDatabase(t, "")
	databaseURL := harness.databaseURL(t, databaseName, adminUser, adminPassword)
	migrator, err := schemamigrations.New(databaseURL, nil, integrationProviderCipher())
	if err != nil {
		t.Fatalf("create schema migrator: %v", err)
	}
	defer func() { _ = migrator.Close() }()
	if err := migrator.Up(t.Context()); err != nil {
		t.Fatalf("apply schema without runtime roles: %v", err)
	}
	if err := migrator.Check(t.Context()); err != nil {
		t.Fatalf("check schema without runtime roles: %v", err)
	}
	if err := migrator.InstallGrants(t.Context()); err == nil ||
		!strings.Contains(err.Error(), "database role "+executionRole+" is not installed") {
		t.Fatalf("missing-role grant error = %v", err)
	}

	admin := connect(t, harness.adminURL)
	if _, err := admin.Exec(t.Context(), fmt.Sprintf(`
		create role %s login password '%s';
		create role %s nologin;
		create role %s login password '%s';
	`,
		pgx.Identifier{executionRole}.Sanitize(), executionPassword,
		pgx.Identifier{appAPIRole}.Sanitize(),
		pgx.Identifier{opsWebRole}.Sanitize(), opsWebPassword,
	)); err != nil {
		closeConn(t, admin)
		t.Fatalf("install non-publisher roles for missing publisher test: %v", err)
	}
	closeConn(t, admin)
	err = migrator.InstallGrants(t.Context())
	if err != nil {
		t.Fatalf("install grants with runtime roles: %v", err)
	}
	databaseConn := connect(t, databaseURL)
	if _, err := databaseConn.Exec(t.Context(), fmt.Sprintf(
		"drop owned by %s, %s, %s",
		pgx.Identifier{executionRole}.Sanitize(),
		pgx.Identifier{appAPIRole}.Sanitize(),
		pgx.Identifier{opsWebRole}.Sanitize(),
	)); err != nil {
		closeConn(t, databaseConn)
		t.Fatalf("remove non-publisher database privileges after missing publisher test: %v", err)
	}
	closeConn(t, databaseConn)
	admin = connect(t, harness.adminURL)
	if _, err := admin.Exec(t.Context(), fmt.Sprintf(
		"drop role %s, %s, %s",
		pgx.Identifier{executionRole}.Sanitize(),
		pgx.Identifier{appAPIRole}.Sanitize(),
		pgx.Identifier{opsWebRole}.Sanitize(),
	)); err != nil {
		closeConn(t, admin)
		t.Fatalf("remove non-publisher roles after missing publisher test: %v", err)
	}
	closeConn(t, admin)
}

func testProviderConfig(t *testing.T, harness *postgresHarness) {
	t.Run("current settings encryption validation and grants", func(t *testing.T) {
		databaseName, ownerURL, runtimeURL, keyring := newProviderDatabase(t, harness)
		runtimeStore := newProviderStore(t, runtimeURL, keyring)

		empty, err := runtimeStore.Status(t.Context())
		if err != nil {
			t.Fatalf("read empty model settings: %v", err)
		}
		if empty.Settings[providerconfig.KindLLM] != nil || empty.Settings[providerconfig.KindEmbedding] != nil ||
			empty.Settings[providerconfig.KindNoticeClassifier] != nil {
			t.Fatalf("empty model settings = %#v", empty)
		}

		llm := providerconfig.RuntimeSetting{
			APIKey:    "sk-integration-provider-secret",
			BaseURL:   "https://provider.integration.example/v1",
			Kind:      providerconfig.KindLLM,
			Model:     "integration-primary",
			Provider:  "openai-compatible",
			Transport: "responses",
		}
		status, err := runtimeStore.Put(
			t.Context(),
			"ops:integration",
			llm,
			providerconfig.ValidationResult{Message: "integration validation", Status: "passed"},
		)
		if err != nil {
			t.Fatalf("save llm setting: %v", err)
		}
		embedding := providerconfig.RuntimeSetting{
			APIKey:    "sk-integration-embedding-secret",
			BaseURL:   "https://embedding.integration.example/v1",
			Kind:      providerconfig.KindEmbedding,
			Model:     "Qwen3-Embedding-4B",
			Provider:  "openai-compatible",
			Transport: "embeddings",
		}
		status, err = runtimeStore.Put(
			t.Context(),
			"ops:integration",
			embedding,
			providerconfig.ValidationResult{Message: "integration validation", ObservedDimensions: 2560, Status: "passed"},
		)
		if err != nil {
			t.Fatalf("save embedding setting: %v", err)
		}
		classifier := providerconfig.RuntimeSetting{
			APIKey:    "sk-integration-classifier-secret",
			BaseURL:   "https://classifier.integration.example/v1",
			Kind:      providerconfig.KindNoticeClassifier,
			Model:     "integration-classifier",
			Provider:  "openai-compatible",
			Transport: "chat_completions",
		}
		status, err = runtimeStore.Put(
			t.Context(),
			"ops:integration",
			classifier,
			providerconfig.ValidationResult{Message: "integration validation", Status: "passed"},
		)
		if err != nil {
			t.Fatalf("save notice classifier setting: %v", err)
		}
		if status.Settings[providerconfig.KindLLM] == nil || status.Settings[providerconfig.KindEmbedding] == nil ||
			status.Settings[providerconfig.KindNoticeClassifier] == nil {
			t.Fatalf("configured model settings = %#v", status.Settings)
		}
		for kind, setting := range status.Settings {
			if setting.UpdatedAt.Location() != time.UTC || setting.LatestValidation.ValidatedAt.Location() != time.UTC {
				t.Fatalf("%s setting timestamps are not UTC: %#v", kind, setting)
			}
		}

		ownerConn := connect(t, ownerURL)
		defer closeConn(t, ownerConn)
		var ciphertext []byte
		if err := ownerConn.QueryRow(
			t.Context(),
			"select secret_ciphertext from execution_control.model_settings where kind='llm'",
		).Scan(&ciphertext); err != nil {
			t.Fatalf("read encrypted model credential: %v", err)
		}
		if len(ciphertext) == 0 || strings.Contains(string(ciphertext), llm.APIKey) {
			t.Fatal("model credential was not stored as ciphertext")
		}

		if err := runtimeStore.HealthCheck(t.Context()); err != nil {
			t.Fatalf("runtime store health check: %v", err)
		}
		resolvedLLM, err := runtimeStore.Resolve(t.Context(), providerconfig.KindLLM)
		if err != nil || resolvedLLM.APIKey != llm.APIKey || resolvedLLM.Model != llm.Model {
			t.Fatalf("resolved llm setting = %#v error=%v", resolvedLLM, err)
		}
		resolvedClassifier, err := runtimeStore.Resolve(t.Context(), providerconfig.KindNoticeClassifier)
		if err != nil || resolvedClassifier.APIKey != classifier.APIKey || resolvedClassifier.Model != classifier.Model {
			t.Fatalf("resolved notice classifier setting = %#v error=%v", resolvedClassifier, err)
		}
		retained, err := runtimeStore.Candidate(t.Context(), providerconfig.SettingInput{
			BaseURL:   llm.BaseURL,
			Kind:      providerconfig.KindLLM,
			Model:     "integration-primary-next",
			Provider:  llm.Provider,
			Transport: llm.Transport,
		})
		if err != nil || retained.APIKey != llm.APIKey {
			t.Fatalf("retain existing credential = %#v error=%v", retained, err)
		}

		if status.Settings[providerconfig.KindLLM].LatestValidation == nil ||
			status.Settings[providerconfig.KindLLM].LatestValidation.Status != "passed" {
			t.Fatalf("llm validation = %#v", status.Settings[providerconfig.KindLLM].LatestValidation)
		}
		rawStatus, err := json.Marshal(status)
		if err != nil {
			t.Fatalf("marshal model settings status: %v", err)
		}
		for _, forbidden := range []string{llm.APIKey, embedding.APIKey, classifier.APIKey, "secretCiphertext", "secretNonce"} {
			if strings.Contains(string(rawStatus), forbidden) {
				t.Fatalf("model settings status exposed forbidden value %q", forbidden)
			}
		}
		assertProviderRoleGrants(t, harness, databaseName, runtimeURL)
	})

	t.Run("schema check rejects drift after an applied migration", func(t *testing.T) {
		_, ownerURL, runtimeURL, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, runtimeURL, keyring)
		_, err := store.Put(t.Context(), "ops:integration", providerconfig.RuntimeSetting{
			APIKey: "sk-existing", BaseURL: "https://provider.integration.example/v1", Kind: providerconfig.KindLLM,
			Model: "existing-model", Provider: "openai-compatible", Transport: "responses",
		}, providerconfig.ValidationResult{Message: "passed", Status: "passed"})
		if err != nil {
			t.Fatal(err)
		}

		ownerConn := connect(t, ownerURL)
		if _, err := ownerConn.Exec(t.Context(), `alter table execution_control.model_settings
			add column timeout_ms integer not null default 30000 check (timeout_ms > 0)`); err != nil {
			closeConn(t, ownerConn)
			t.Fatalf("restore retired timeout column: %v", err)
		}
		closeConn(t, ownerConn)

		if err := migrateSchema(t.Context(), ownerURL, nil); err != nil {
			t.Fatalf("repeat applied migrations: %v", err)
		}
		if err := providerconfig.CheckDatabaseSchema(t.Context(), ownerURL); err == nil {
			t.Fatal("schema check accepted a retired timeout column added after migration")
		}
		resolved, err := store.Resolve(t.Context(), providerconfig.KindLLM)
		if err != nil || resolved.Model != "existing-model" || resolved.APIKey != "sk-existing" {
			t.Fatalf("setting after schema drift = %#v error=%v", resolved, err)
		}
	})

	t.Run("stored secrets require the matching encryption key", func(t *testing.T) {
		_, _, runtimeURL, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, runtimeURL, keyring)
		_, err := store.Put(t.Context(), "ops:integration", providerconfig.RuntimeSetting{
			APIKey: "sk-existing", BaseURL: "https://provider.integration.example/v1", Kind: providerconfig.KindLLM,
			Model: "existing-model", Provider: "openai-compatible", Transport: "responses",
		}, providerconfig.ValidationResult{Message: "passed", Status: "passed"})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.StoredSecretsCheck(t.Context()); err != nil {
			t.Fatalf("check stored secrets with matching encryption key: %v", err)
		}
		mismatchedKey := make([]byte, 32)
		for index := range mismatchedKey {
			mismatchedKey[index] = byte(0xb0 + index)
		}
		mismatchedCipher, err := providerconfig.NewSecretCipher(mismatchedKey)
		if err != nil {
			t.Fatal(err)
		}
		mismatchedStore, err := providerconfig.NewStore(t.Context(), runtimeURL, mismatchedCipher)
		if err != nil {
			t.Fatal(err)
		}
		defer mismatchedStore.Close()
		if err := mismatchedStore.StoredSecretsCheck(t.Context()); err == nil ||
			!strings.Contains(err.Error(), "decrypt stored llm model setting") {
			t.Fatalf("stored secrets mismatch error = %v", err)
		}
	})
}

func newProviderDatabase(
	t *testing.T,
	harness *postgresHarness,
) (databaseName, ownerURL, runtimeURL string, keyring *providerconfig.Keyring) {
	t.Helper()
	databaseName, ownerURL = harness.ownerDatabase(t)
	if err := migrateSchema(t.Context(), ownerURL, nil); err != nil {
		t.Fatalf("install model settings schema: %v", err)
	}
	if err := migrateSchema(t.Context(), ownerURL, nil); err != nil {
		t.Fatalf("reinstall model settings schema: %v", err)
	}
	if err := providerconfig.CheckDatabaseSchema(t.Context(), ownerURL); err != nil {
		t.Fatalf("check model settings schema: %v", err)
	}
	runtimeURL = harness.databaseURL(t, databaseName, executionRole, executionPassword)
	keyring = loadIntegrationKeyring(t)
	return databaseName, ownerURL, runtimeURL, keyring
}

func loadIntegrationKeyring(t *testing.T) *providerconfig.Keyring {
	t.Helper()
	return loadIntegrationKeyringWithOffset(t, 1)
}

func loadIntegrationKeyringWithOffset(t *testing.T, offset byte) *providerconfig.Keyring {
	t.Helper()
	key := make([]byte, 32)
	for index := range key {
		key[index] = offset + byte(index)
	}
	payload := fmt.Sprintf(
		`{"active_key_id":"integration-key","keys":{"integration-key":%q}}`,
		base64.StdEncoding.EncodeToString(key),
	)
	path := filepath.Join(t.TempDir(), "provider-keyring.json")
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatalf("write provider keyring: %v", err)
	}
	keyring, err := providerconfig.LoadKeyring(path)
	if err != nil {
		t.Fatalf("load provider keyring: %v", err)
	}
	return keyring
}

func writeIntegrationProviderSecrets(t *testing.T) (keyringPath, encryptionKeyPath string) {
	t.Helper()
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(index + 1)
	}
	payload := fmt.Sprintf(
		`{"active_key_id":"integration-key","keys":{"integration-key":%q}}`,
		base64.StdEncoding.EncodeToString(key),
	)
	directory := t.TempDir()
	keyringPath = filepath.Join(directory, "provider-keyring.json")
	if err := os.WriteFile(keyringPath, []byte(payload), 0o600); err != nil {
		t.Fatalf("write provider keyring: %v", err)
	}
	encryptionKeyPath = filepath.Join(directory, "encryption.key")
	if err := os.WriteFile(encryptionKeyPath, []byte(base64.StdEncoding.EncodeToString(integrationEncryptionKey())), 0o600); err != nil {
		t.Fatalf("write provider encryption key: %v", err)
	}
	return keyringPath, encryptionKeyPath
}

func writeIntegrationEncryptionKey(t *testing.T, offset byte) string {
	t.Helper()
	key := make([]byte, 32)
	for index := range key {
		key[index] = offset + byte(index)
	}
	path := filepath.Join(t.TempDir(), "encryption.key")
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(key)), 0o600); err != nil {
		t.Fatalf("write provider encryption key: %v", err)
	}
	return path
}

func integrationEncryptionKey() []byte {
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(0xa0 + index)
	}
	return key
}

func newProviderStore(
	t *testing.T,
	databaseURL string,
	_ *providerconfig.Keyring,
) *providerconfig.Store {
	t.Helper()
	store, err := providerconfig.NewStore(t.Context(), databaseURL, integrationProviderCipher())
	if err != nil {
		t.Fatalf("create model settings store: %v", err)
	}
	t.Cleanup(store.Close)
	return store
}

func assertProviderRoleGrants(
	t *testing.T,
	harness *postgresHarness,
	databaseName string,
	runtimeURL string,
) {
	t.Helper()
	runtimeConn := connect(t, runtimeURL)
	defer closeConn(t, runtimeConn)
	var count int
	if err := runtimeConn.QueryRow(t.Context(), "select count(*) from execution_control.model_settings").Scan(&count); err != nil {
		t.Fatalf("runtime select model settings: %v", err)
	}

	ownerURL := harness.databaseURL(t, databaseName, ownerRole, ownerPassword)
	ownerConn := connect(t, ownerURL)
	defer closeConn(t, ownerConn)
	checks := []struct {
		role      string
		privilege string
		want      bool
	}{
		{role: executionRole, privilege: "SELECT", want: true},
		{role: executionRole, privilege: "INSERT", want: true},
		{role: executionRole, privilege: "UPDATE", want: true},
		{role: executionRole, privilege: "DELETE", want: true},
	}
	for _, check := range checks {
		var granted bool
		if err := ownerConn.QueryRow(
			t.Context(),
			"select has_table_privilege($1,'execution_control.model_settings',$2)",
			check.role,
			check.privilege,
		).Scan(&granted); err != nil {
			t.Fatalf("check %s %s: %v", check.role, check.privilege, err)
		}
		if granted != check.want {
			t.Fatalf("%s %s = %t, want %t", check.role, check.privilege, granted, check.want)
		}
	}
}
