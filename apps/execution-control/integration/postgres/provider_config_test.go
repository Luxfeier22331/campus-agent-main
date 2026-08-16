//go:build postgres_integration

package postgres_test

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/schemamigrations"
	"github.com/jackc/pgx/v5"
)

func testSchemaMigrationsWithoutGrantRoles(t *testing.T, harness *postgresHarness) {
	databaseName := harness.createDatabase(t, "")
	databaseURL := harness.databaseURL(t, databaseName, adminUser, adminPassword)
	migrator, err := schemamigrations.New(databaseURL, nil)
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
	if err == nil || !strings.Contains(err.Error(), "database role "+publisherRole+" is not installed") {
		t.Fatalf("missing publisher role grant error = %v", err)
	}
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
		if empty.Settings[providerconfig.KindLLM] != nil || empty.Settings[providerconfig.KindEmbedding] != nil || empty.ETag == "" {
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
			empty.ETag,
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
			status.ETag,
			embedding,
			providerconfig.ValidationResult{Message: "integration validation", ObservedDimensions: 2560, Status: "passed"},
		)
		if err != nil {
			t.Fatalf("save embedding setting: %v", err)
		}
		if status.Settings[providerconfig.KindLLM] == nil || status.Settings[providerconfig.KindEmbedding] == nil {
			t.Fatalf("configured model settings = %#v", status.Settings)
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

		const rawProviderMessage = "upstream https://private-provider.example rejected secret"
		if err := runtimeStore.RecordValidation(
			t.Context(),
			"ops:integration",
			providerconfig.KindLLM,
			providerconfig.ValidationResult{ErrorCode: "provider_unavailable", Message: "provider request failed", Status: "failed"},
			status.Settings[providerconfig.KindLLM].UpdatedAt,
		); err != nil {
			t.Fatalf("record failed validation: %v", err)
		}
		status, err = runtimeStore.Status(t.Context())
		if err != nil {
			t.Fatalf("read status after failed validation: %v", err)
		}
		if status.Settings[providerconfig.KindLLM].LatestValidation.Status != "failed" {
			t.Fatalf("llm validation = %#v", status.Settings[providerconfig.KindLLM].LatestValidation)
		}
		rawStatus, err := json.Marshal(status)
		if err != nil {
			t.Fatalf("marshal model settings status: %v", err)
		}
		for _, forbidden := range []string{llm.APIKey, embedding.APIKey, rawProviderMessage, "secretCiphertext", "secretNonce"} {
			if strings.Contains(string(rawStatus), forbidden) {
				t.Fatalf("model settings status exposed forbidden value %q", forbidden)
			}
		}
		assertProviderRoleGrants(t, harness, databaseName, runtimeURL)
	})

	t.Run("schema check rejects drift after an applied migration", func(t *testing.T) {
		_, ownerURL, runtimeURL, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, runtimeURL, keyring)
		empty, err := store.Status(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		_, err = store.Put(t.Context(), "ops:integration", empty.ETag, providerconfig.RuntimeSetting{
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

	t.Run("concurrent updates reject stale etag", func(t *testing.T) {
		_, _, runtimeURL, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, runtimeURL, keyring)
		status, err := store.Status(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		results := make(chan error, 2)
		var waitGroup sync.WaitGroup
		for index := range 2 {
			waitGroup.Add(1)
			go func(index int) {
				defer waitGroup.Done()
				<-start
				_, putErr := store.Put(
					t.Context(),
					"ops:integration",
					status.ETag,
					providerconfig.RuntimeSetting{
						APIKey:    fmt.Sprintf("sk-race-%d", index),
						BaseURL:   "https://provider.integration.example/v1",
						Kind:      providerconfig.KindLLM,
						Model:     fmt.Sprintf("model-%d", index),
						Provider:  "openai-compatible",
						Transport: "responses",
					},
					providerconfig.ValidationResult{Message: "passed", Status: "passed"},
				)
				results <- putErr
			}(index)
		}
		close(start)
		waitGroup.Wait()
		close(results)
		var succeeded, conflicted int
		for result := range results {
			switch {
			case result == nil:
				succeeded++
			case errors.Is(result, providerconfig.ErrConflict):
				conflicted++
			default:
				t.Fatalf("unexpected concurrent update error: %v", result)
			}
		}
		if succeeded != 1 || conflicted != 1 {
			t.Fatalf("concurrent updates = %d succeeded/%d conflicted", succeeded, conflicted)
		}
	})

	t.Run("late validation cannot update a newer setting", func(t *testing.T) {
		_, _, runtimeURL, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, runtimeURL, keyring)
		initial, err := store.Status(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		first, err := store.Put(t.Context(), "ops:integration", initial.ETag, providerconfig.RuntimeSetting{
			APIKey: "sk-before", BaseURL: "https://provider.integration.example/v1", Kind: providerconfig.KindLLM,
			Model: "model-before", Provider: "openai-compatible", Transport: "responses",
		}, providerconfig.ValidationResult{Message: "passed", Status: "passed"})
		if err != nil {
			t.Fatal(err)
		}
		staleUpdatedAt := first.Settings[providerconfig.KindLLM].UpdatedAt
		second, err := store.Put(t.Context(), "ops:integration", first.ETag, providerconfig.RuntimeSetting{
			APIKey: "sk-after", BaseURL: "https://provider.integration.example/v1", Kind: providerconfig.KindLLM,
			Model: "model-after", Provider: "openai-compatible", Transport: "responses",
		}, providerconfig.ValidationResult{Message: "passed", Status: "passed"})
		if err != nil {
			t.Fatal(err)
		}
		if second.Settings[providerconfig.KindLLM].UpdatedAt.Equal(staleUpdatedAt) {
			t.Fatal("setting update did not advance updated_at fence")
		}
		err = store.RecordValidation(t.Context(), "ops:integration", providerconfig.KindLLM,
			providerconfig.ValidationResult{ErrorCode: "late", Message: "late result", Status: "failed"}, staleUpdatedAt)
		if !errors.Is(err, providerconfig.ErrConflict) {
			t.Fatalf("late validation error = %v, want ErrConflict", err)
		}
		latest, err := store.Status(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if latest.Settings[providerconfig.KindLLM].Model != "model-after" || latest.Settings[providerconfig.KindLLM].LatestValidation.Status != "passed" {
			t.Fatalf("late validation overwrote newer setting: %#v", latest.Settings[providerconfig.KindLLM])
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
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(index + 1)
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

func newProviderStore(
	t *testing.T,
	databaseURL string,
	keyring *providerconfig.Keyring,
) *providerconfig.Store {
	t.Helper()
	store, err := providerconfig.NewStore(t.Context(), databaseURL, keyring)
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
