//go:build postgres_integration

package postgres_test

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
