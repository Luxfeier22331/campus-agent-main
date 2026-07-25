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
	"github.com/jackc/pgx/v5/pgconn"
)

func testProviderSchemaRejectsMissingRoles(t *testing.T, harness *postgresHarness) {
	databaseName := harness.createDatabase(t, "")
	databaseURL := harness.databaseURL(t, databaseName, adminUser, adminPassword)
	err := providerconfig.EnsureDatabaseSchema(t.Context(), databaseURL)
	if err == nil || !strings.Contains(err.Error(), "database role "+readerRole+" is not installed") {
		t.Fatalf("missing-role schema error = %v", err)
	}
}

func testProviderConfig(t *testing.T, harness *postgresHarness) {
	t.Run("current settings encryption validation and grants", func(t *testing.T) {
		databaseName, ownerURL, adminURL, readerURL, keyring := newProviderDatabase(t, harness)
		adminStore := newProviderStore(t, adminURL, keyring)

		empty, err := adminStore.Status(t.Context())
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
		status, err := adminStore.Put(
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
			APIKey:     "sk-integration-embedding-secret",
			BaseURL:    "https://embedding.integration.example/v1",
			Dimensions: 2560,
			Kind:       providerconfig.KindEmbedding,
			Model:      "Qwen3-Embedding-4B",
			Provider:   "openai-compatible",
			Transport:  "embeddings",
		}
		status, err = adminStore.Put(
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
			"select secret_ciphertext from execution_config.model_settings where kind='llm'",
		).Scan(&ciphertext); err != nil {
			t.Fatalf("read encrypted model credential: %v", err)
		}
		if len(ciphertext) == 0 || strings.Contains(string(ciphertext), llm.APIKey) {
			t.Fatal("model credential was not stored as ciphertext")
		}

		readerStore := newProviderStore(t, readerURL, keyring)
		if err := readerStore.HealthCheck(t.Context()); err != nil {
			t.Fatalf("reader store health check: %v", err)
		}
		resolvedLLM, err := readerStore.Resolve(t.Context(), providerconfig.KindLLM)
		if err != nil || resolvedLLM.APIKey != llm.APIKey || resolvedLLM.Model != llm.Model {
			t.Fatalf("resolved llm setting = %#v error=%v", resolvedLLM, err)
		}
		retained, err := adminStore.Candidate(t.Context(), providerconfig.SettingInput{
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
		if err := adminStore.RecordValidation(
			t.Context(),
			"ops:integration",
			providerconfig.KindLLM,
			providerconfig.ValidationResult{ErrorCode: "provider_unavailable", Message: "provider request failed", Status: "failed"},
			status.Settings[providerconfig.KindLLM].UpdatedAt,
		); err != nil {
			t.Fatalf("record failed validation: %v", err)
		}
		status, err = adminStore.Status(t.Context())
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
		assertProviderRoleGrants(t, harness, databaseName, readerURL, adminURL)
	})

	t.Run("schema removes retired timeout column without deleting settings", func(t *testing.T) {
		_, ownerURL, adminURL, _, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, adminURL, keyring)
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
		if _, err := ownerConn.Exec(t.Context(), `alter table execution_config.model_settings
			add column timeout_ms integer not null default 30000 check (timeout_ms > 0)`); err != nil {
			closeConn(t, ownerConn)
			t.Fatalf("restore retired timeout column: %v", err)
		}
		closeConn(t, ownerConn)

		if err := providerconfig.EnsureDatabaseSchema(t.Context(), ownerURL); err != nil {
			t.Fatalf("remove retired timeout column: %v", err)
		}
		if err := providerconfig.CheckDatabaseSchema(t.Context(), ownerURL); err != nil {
			t.Fatalf("check schema after timeout removal: %v", err)
		}
		resolved, err := store.Resolve(t.Context(), providerconfig.KindLLM)
		if err != nil || resolved.Model != "existing-model" || resolved.APIKey != "sk-existing" {
			t.Fatalf("setting after timeout removal = %#v error=%v", resolved, err)
		}
	})

	t.Run("concurrent updates reject stale etag", func(t *testing.T) {
		_, _, adminURL, _, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, adminURL, keyring)
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
		_, _, adminURL, _, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, adminURL, keyring)
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
) (databaseName, ownerURL, adminURL, readerURL string, keyring *providerconfig.Keyring) {
	t.Helper()
	databaseName, ownerURL = harness.ownerDatabase(t)
	if err := providerconfig.EnsureDatabaseSchema(t.Context(), ownerURL); err != nil {
		t.Fatalf("install model settings schema: %v", err)
	}
	if err := providerconfig.EnsureDatabaseSchema(t.Context(), ownerURL); err != nil {
		t.Fatalf("reinstall model settings schema: %v", err)
	}
	if err := providerconfig.CheckDatabaseSchema(t.Context(), ownerURL); err != nil {
		t.Fatalf("check model settings schema: %v", err)
	}
	adminURL = harness.databaseURL(t, databaseName, adminRole, providerAdminPassword)
	readerURL = harness.databaseURL(t, databaseName, readerRole, readerPassword)
	keyring = loadIntegrationKeyring(t)
	return databaseName, ownerURL, adminURL, readerURL, keyring
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
	readerURL string,
	adminURL string,
) {
	t.Helper()
	readerConn := connect(t, readerURL)
	defer closeConn(t, readerConn)
	var count int
	if err := readerConn.QueryRow(t.Context(), "select count(*) from execution_config.model_settings").Scan(&count); err != nil {
		t.Fatalf("reader select model settings: %v", err)
	}
	_, err := readerConn.Exec(
		t.Context(),
		`insert into execution_config.model_settings
		(kind,provider,base_url,model,transport,secret_key_id,secret_nonce,secret_ciphertext,
		 secret_fingerprint,secret_last4,validation_status,validated_at,validated_by,updated_at,updated_by)
		values ('llm','openai','https://example.test','model','responses','key','x','x','x','last','passed',now(),'reader',now(),'reader')`,
	)
	assertSQLState(t, err, "42501")

	ownerURL := harness.databaseURL(t, databaseName, ownerRole, ownerPassword)
	ownerConn := connect(t, ownerURL)
	defer closeConn(t, ownerConn)
	checks := []struct {
		role      string
		privilege string
		want      bool
	}{
		{role: readerRole, privilege: "SELECT", want: true},
		{role: readerRole, privilege: "INSERT", want: false},
		{role: adminRole, privilege: "SELECT", want: true},
		{role: adminRole, privilege: "UPDATE", want: true},
	}
	for _, check := range checks {
		var granted bool
		if err := ownerConn.QueryRow(
			t.Context(),
			"select has_table_privilege($1,'execution_config.model_settings',$2)",
			check.role,
			check.privilege,
		).Scan(&granted); err != nil {
			t.Fatalf("check %s %s: %v", check.role, check.privilege, err)
		}
		if granted != check.want {
			t.Fatalf("%s %s = %t, want %t", check.role, check.privilege, granted, check.want)
		}
	}

	adminConn := connect(t, adminURL)
	defer closeConn(t, adminConn)
	if err := adminConn.QueryRow(t.Context(), "select count(*) from execution_config.model_settings").Scan(&count); err != nil {
		t.Fatalf("admin select model settings: %v", err)
	}
}

func assertSQLState(t *testing.T, err error, want string) {
	t.Helper()
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != want {
		t.Fatalf("PostgreSQL error = %v, want SQLSTATE %s", err, want)
	}
}
