//go:build postgres_integration

package postgres_test

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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
	t.Run("schema grants encryption receipts and activation race", func(t *testing.T) {
		databaseName, ownerURL, adminURL, readerURL, keyring := newProviderDatabase(t, harness)
		adminStore := newProviderStore(t, adminURL, keyring)

		connectionInput := providerconfig.ConnectionInput{
			APIKey:        "sk-integration-provider-secret",
			BaseURL:       "https://provider.integration.example/v1",
			ConnectionID:  "connection-main",
			Features:      []string{"prompt", "embedding"},
			FeatureConfig: map[string]any{"responses": map[string]any{"store": false}},
			Provider:      "openai-compatible",
		}
		connection, status, err := adminStore.CreateConnection(
			t.Context(),
			"ops:integration",
			"connection-create-main",
			"hash-connection-main",
			connectionInput,
		)
		if err != nil || status != 201 || connection.Revision != 1 {
			t.Fatalf("create connection = %#v status=%d error=%v", connection, status, err)
		}
		replayed, status, err := adminStore.CreateConnection(
			t.Context(),
			"ops:integration",
			"connection-create-main",
			"hash-connection-main",
			connectionInput,
		)
		if err != nil || status != 201 || !reflect.DeepEqual(replayed, connection) {
			t.Fatalf("replay connection = %#v status=%d error=%v", replayed, status, err)
		}
		_, status, err = adminStore.CreateConnection(
			t.Context(),
			"ops:integration",
			"connection-create-main",
			"different-request-hash",
			connectionInput,
		)
		if status != 409 || !errors.Is(err, providerconfig.ErrConflict) {
			t.Fatalf("conflicting connection receipt status=%d error=%v", status, err)
		}
		_, status, err = adminStore.CreateProfile(
			t.Context(),
			"ops:integration",
			"connection-create-main",
			"hash-connection-main",
			providerconfig.ProfileInput{},
		)
		if status != 409 || !errors.Is(err, providerconfig.ErrConflict) {
			t.Fatalf("cross-operation receipt status=%d error=%v", status, err)
		}

		ownerConn := connect(t, ownerURL)
		defer closeConn(t, ownerConn)
		var ciphertext []byte
		var receiptCount int
		if err := ownerConn.QueryRow(
			t.Context(),
			"select secret_ciphertext from execution_config.connection_revisions where connection_id=$1 and revision=1",
			connection.ConnectionID,
		).Scan(&ciphertext); err != nil {
			t.Fatalf("read encrypted secret: %v", err)
		}
		if len(ciphertext) == 0 || strings.Contains(string(ciphertext), connectionInput.APIKey) {
			t.Fatalf("provider secret was not stored as ciphertext")
		}
		if err := ownerConn.QueryRow(t.Context(), "select count(*) from execution_config.command_receipts").Scan(&receiptCount); err != nil {
			t.Fatalf("count command receipts: %v", err)
		}
		if receiptCount != 1 {
			t.Fatalf("command receipt count = %d, want 1", receiptCount)
		}

		primaryProfile := createValidatedProfile(t, adminStore, connection, providerconfig.ProfileInput{
			ConnectionID:       connection.ConnectionID,
			ConnectionRevision: connection.Revision,
			Kind:               "prompt",
			Model:              "integration-primary",
			ProfileID:          "profile-primary",
			Role:               providerconfig.RolePrimaryAgent,
			TimeoutMS:          5000,
			Transport:          "responses",
		})
		embeddingProfile := createValidatedProfile(t, adminStore, connection, providerconfig.ProfileInput{
			ConnectionID:       connection.ConnectionID,
			ConnectionRevision: connection.Revision,
			Dimensions:         3,
			Kind:               "embedding",
			Model:              "integration-embedding",
			ProfileID:          "profile-embedding",
			Role:               providerconfig.RoleRAGQueryEmbedding,
			TimeoutMS:          5000,
			Transport:          "embeddings",
		})
		activationInput := providerconfig.ActivationInput{
			ExpectedRevision: 0,
			Profiles: map[providerconfig.Role]string{
				providerconfig.RolePrimaryAgent:      primaryProfile.ProfileID,
				providerconfig.RoleRAGQueryEmbedding: embeddingProfile.ProfileID,
			},
		}
		type activationResult struct {
			key      string
			hash     string
			response map[string]any
			status   int
			err      error
		}
		start := make(chan struct{})
		results := make(chan activationResult, 2)
		var waitGroup sync.WaitGroup
		for index := range 2 {
			waitGroup.Add(1)
			go func(index int) {
				defer waitGroup.Done()
				key := fmt.Sprintf("activation-race-%d", index)
				hash := fmt.Sprintf("hash-activation-race-%d", index)
				<-start
				response, status, err := adminStore.Activate(
					t.Context(),
					"ops:integration",
					key,
					hash,
					activationInput,
				)
				results <- activationResult{key: key, hash: hash, response: response, status: status, err: err}
			}(index)
		}
		close(start)
		waitGroup.Wait()
		close(results)
		var winner activationResult
		succeeded := 0
		conflicted := 0
		for result := range results {
			switch {
			case result.err == nil && result.status == 200:
				succeeded++
				winner = result
			case result.status == 409 && errors.Is(result.err, providerconfig.ErrConflict):
				conflicted++
			default:
				t.Fatalf("activation race result = %#v", result)
			}
		}
		if succeeded != 1 || conflicted != 1 {
			t.Fatalf("activation results = %d succeeded/%d conflicted, want 1/1", succeeded, conflicted)
		}
		replayedActivation, status, err := adminStore.Activate(
			t.Context(),
			"ops:integration",
			winner.key,
			winner.hash,
			activationInput,
		)
		if err != nil || status != 200 || replayedActivation["bundleId"] != winner.response["bundleId"] {
			t.Fatalf("activation replay = %#v status=%d error=%v", replayedActivation, status, err)
		}

		readerStore := newProviderStore(t, readerURL, keyring)
		if err := readerStore.HealthCheck(t.Context()); err != nil {
			t.Fatalf("reader store health check: %v", err)
		}
		bundle, err := readerStore.ResolveBundle(t.Context())
		if err != nil {
			t.Fatalf("resolve provider bundle: %v", err)
		}
		for _, role := range []providerconfig.Role{
			providerconfig.RolePrimaryAgent,
			providerconfig.RoleRAGQueryEmbedding,
		} {
			snapshot, ok := bundle[role]
			if !ok || snapshot.APIKey != connectionInput.APIKey || snapshot.Revision != 1 {
				t.Fatalf("runtime snapshot for %s = %#v", role, snapshot)
			}
		}
		assertProviderRoleGrants(t, harness, databaseName, readerURL, adminURL)
	})

	t.Run("connection revisions are serialized", func(t *testing.T) {
		_, ownerURL, adminURL, _, keyring := newProviderDatabase(t, harness)
		store := newProviderStore(t, adminURL, keyring)
		const revisionCount = 10
		start := make(chan struct{})
		type revisionResult struct {
			revision int64
			err      error
		}
		results := make(chan revisionResult, revisionCount)
		var waitGroup sync.WaitGroup
		for index := range revisionCount {
			waitGroup.Add(1)
			go func(index int) {
				defer waitGroup.Done()
				<-start
				view, _, err := store.CreateConnection(
					t.Context(),
					"ops:integration",
					fmt.Sprintf("connection-revision-%02d", index),
					fmt.Sprintf("hash-connection-revision-%02d", index),
					providerconfig.ConnectionInput{
						APIKey:       fmt.Sprintf("sk-revision-%02d", index),
						BaseURL:      "https://provider.integration.example/v1",
						ConnectionID: "connection-concurrent",
						Features:     []string{"prompt"},
						Provider:     "openai-compatible",
					},
				)
				results <- revisionResult{revision: view.Revision, err: err}
			}(index)
		}
		close(start)
		waitGroup.Wait()
		close(results)
		revisions := make([]int64, 0, revisionCount)
		for result := range results {
			if result.err != nil {
				t.Fatalf("create concurrent connection revision: %v", result.err)
			}
			revisions = append(revisions, result.revision)
		}
		want := make([]int64, revisionCount)
		for index := range revisionCount {
			want[index] = int64(index + 1)
		}
		if got := sortedInts(revisions); !reflect.DeepEqual(got, want) {
			t.Fatalf("connection revisions = %v, want %v", got, want)
		}
		ownerConn := connect(t, ownerURL)
		defer closeConn(t, ownerConn)
		var count int
		if err := ownerConn.QueryRow(
			t.Context(),
			"select count(*) from execution_config.connection_revisions where connection_id='connection-concurrent'",
		).Scan(&count); err != nil {
			t.Fatalf("count connection revisions: %v", err)
		}
		if count != revisionCount {
			t.Fatalf("stored connection revisions = %d, want %d", count, revisionCount)
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
		t.Fatalf("install provider config schema: %v", err)
	}
	if err := providerconfig.EnsureDatabaseSchema(t.Context(), ownerURL); err != nil {
		t.Fatalf("reinstall provider config schema: %v", err)
	}
	if err := providerconfig.CheckDatabaseSchema(t.Context(), ownerURL); err != nil {
		t.Fatalf("check provider config schema: %v", err)
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
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat provider keyring: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("provider keyring mode = %v, want 0600", info.Mode().Perm())
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
		t.Fatalf("create provider config store: %v", err)
	}
	t.Cleanup(store.Close)
	return store
}

func createValidatedProfile(
	t *testing.T,
	store *providerconfig.Store,
	connection providerconfig.ConnectionView,
	input providerconfig.ProfileInput,
) providerconfig.ProfileView {
	t.Helper()
	profile, status, err := store.CreateProfile(
		t.Context(),
		"ops:integration",
		"create-"+input.ProfileID,
		"hash-create-"+input.ProfileID,
		input,
	)
	if err != nil || status != 201 {
		t.Fatalf("create profile %s = %#v status=%d error=%v", input.ProfileID, profile, status, err)
	}
	if profile.ConnectionID != connection.ConnectionID || profile.ConnectionRevision != connection.Revision {
		t.Fatalf("profile connection = %#v, want %s:%d", profile, connection.ConnectionID, connection.Revision)
	}
	if err := store.RecordValidation(
		t.Context(),
		"ops:integration",
		profile.ProfileID,
		providerconfig.ValidationResult{Message: "integration validation", Status: "passed"},
	); err != nil {
		t.Fatalf("record validation for %s: %v", profile.ProfileID, err)
	}
	return profile
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
	if err := readerConn.QueryRow(t.Context(), "select count(*) from execution_config.active_bundle").Scan(&count); err != nil {
		t.Fatalf("reader select active bundle: %v", err)
	}
	_, err := readerConn.Exec(
		t.Context(),
		`insert into execution_config.command_receipts
		(idempotency_key,operation,request_sha256,status_code,response_json,created_at)
		values ('reader-forbidden','forbidden','hash',200,'{}'::jsonb,now())`,
	)
	assertSQLState(t, err, "42501")
	err = readerConn.QueryRow(t.Context(), "select count(*) from execution_config.command_receipts").Scan(&count)
	assertSQLState(t, err, "42501")

	ownerURL := harness.databaseURL(t, databaseName, ownerRole, ownerPassword)
	ownerConn := connect(t, ownerURL)
	defer closeConn(t, ownerConn)
	checks := []struct {
		role      string
		table     string
		privilege string
		want      bool
	}{
		{role: readerRole, table: "execution_config.connection_revisions", privilege: "SELECT", want: true},
		{role: readerRole, table: "execution_config.connection_revisions", privilege: "INSERT", want: false},
		{role: readerRole, table: "execution_config.command_receipts", privilege: "SELECT", want: false},
		{role: adminRole, table: "execution_config.command_receipts", privilege: "SELECT", want: true},
		{role: adminRole, table: "execution_config.audit_events", privilege: "INSERT", want: true},
	}
	for _, check := range checks {
		var granted bool
		if err := ownerConn.QueryRow(
			t.Context(),
			"select has_table_privilege($1,$2,$3)",
			check.role,
			check.table,
			check.privilege,
		).Scan(&granted); err != nil {
			t.Fatalf("check %s %s on %s: %v", check.role, check.privilege, check.table, err)
		}
		if granted != check.want {
			t.Fatalf("%s %s on %s = %t, want %t", check.role, check.privilege, check.table, granted, check.want)
		}
	}

	adminConn := connect(t, adminURL)
	defer closeConn(t, adminConn)
	if err := adminConn.QueryRow(t.Context(), "select count(*) from execution_config.command_receipts").Scan(&count); err != nil {
		t.Fatalf("admin select command receipts: %v", err)
	}
}

func assertSQLState(t *testing.T, err error, want string) {
	t.Helper()
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != want {
		t.Fatalf("PostgreSQL error = %v, want SQLSTATE %s", err, want)
	}
}
