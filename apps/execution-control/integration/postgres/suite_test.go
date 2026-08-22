//go:build postgres_integration

package postgres_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/schemamigrations"
	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
)

const (
	postgresImage     = "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
	adminUser         = "postgres"
	adminPassword     = "postgres-integration-admin"
	ownerRole         = "execution_schema_owner"
	ownerPassword     = "execution-schema-owner-password"
	executionRole     = "execution_control"
	executionPassword = "execution-control-password"
	appAPIRole        = "app_api"
	opsWebRole        = "ops_web"
	opsWebPassword    = "ops-web-password"
)

type postgresHarness struct {
	adminURL  string
	moduleDir string
}

func TestPostgresIntegration(t *testing.T) {
	ctx := t.Context()
	container, err := tcpostgres.Run(
		ctx,
		postgresImage,
		tcpostgres.WithDatabase("postgres"),
		tcpostgres.WithUsername(adminUser),
		tcpostgres.WithPassword(adminPassword),
		tcpostgres.BasicWaitStrategies(),
	)
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start PostgreSQL container: %v", err)
	}
	adminURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("resolve PostgreSQL connection string: %v", err)
	}
	harness := &postgresHarness{adminURL: adminURL, moduleDir: executionControlModuleDir(t)}

	t.Run("schema migrations are independent from grant roles", func(t *testing.T) {
		testSchemaMigrationsWithoutGrantRoles(t, harness)
	})
	harness.installClusterRoles(t)
	t.Run("run projection store", func(t *testing.T) {
		testRunProjectionStore(t, harness)
	})
	t.Run("run projection finalization", func(t *testing.T) {
		testRunProjectionFinalizationStore(t, harness)
	})
	t.Run("personal memory state store", func(t *testing.T) {
		testPersonalMemoryStateStore(t, harness)
	})
	t.Run("frozen historical provider config migrations", func(t *testing.T) {
		testLegacyProviderConfigMigration(t, harness)
	})
	t.Run("schema command", func(t *testing.T) {
		testSchemaCommand(t, harness)
	})
}

func executionControlModuleDir(t *testing.T) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve integration test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(source), "..", ".."))
}

func (h *postgresHarness) installClusterRoles(t *testing.T) {
	t.Helper()
	conn := connect(t, h.adminURL)
	defer closeConn(t, conn)
	statements := []string{
		fmt.Sprintf("create role %s login password '%s'", pgx.Identifier{ownerRole}.Sanitize(), ownerPassword),
		fmt.Sprintf("create role %s login password '%s'", pgx.Identifier{executionRole}.Sanitize(), executionPassword),
		fmt.Sprintf("create role %s nologin", pgx.Identifier{appAPIRole}.Sanitize()),
		fmt.Sprintf("create role %s login password '%s'", pgx.Identifier{opsWebRole}.Sanitize(), opsWebPassword),
	}
	for _, statement := range statements {
		if _, err := conn.Exec(t.Context(), statement); err != nil {
			t.Fatalf("install cluster role: %v", err)
		}
	}
}

func (h *postgresHarness) createDatabase(t *testing.T, owner string) string {
	t.Helper()
	databaseName := randomIdentifier(t, "execution_integration")
	conn := connect(t, h.adminURL)
	defer closeConn(t, conn)
	statement := fmt.Sprintf("create database %s", pgx.Identifier{databaseName}.Sanitize())
	if owner != "" {
		statement += " owner " + pgx.Identifier{owner}.Sanitize()
	}
	if _, err := conn.Exec(t.Context(), statement); err != nil {
		t.Fatalf("create database %s: %v", databaseName, err)
	}
	return databaseName
}

func (h *postgresHarness) databaseURL(t *testing.T, databaseName, role, password string) string {
	t.Helper()
	parsed, err := url.Parse(h.adminURL)
	if err != nil {
		t.Fatalf("parse admin database URL: %v", err)
	}
	parsed.User = url.UserPassword(role, password)
	parsed.Path = "/" + databaseName
	parsed.RawPath = ""
	parsed.RawQuery = "sslmode=disable"
	return parsed.String()
}

func (h *postgresHarness) ownerDatabase(t *testing.T) (string, string) {
	t.Helper()
	databaseName := h.createDatabase(t, ownerRole)
	return databaseName, h.databaseURL(t, databaseName, ownerRole, ownerPassword)
}

func randomIdentifier(t *testing.T, prefix string) string {
	t.Helper()
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		t.Fatalf("generate random identifier: %v", err)
	}
	return strings.ToLower(prefix + "_" + hex.EncodeToString(raw))
}

func connect(t *testing.T, databaseURL string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}
	return conn
}

func closeConn(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	if err := conn.Close(context.Background()); err != nil {
		t.Errorf("close PostgreSQL connection: %v", err)
	}
}

func migrateSchema(ctx context.Context, databaseURL string, keyring *providerconfig.Keyring) error {
	migrator, err := schemamigrations.New(databaseURL, keyring, integrationProviderCipher())
	if err != nil {
		return err
	}
	defer func() { _ = migrator.Close() }()
	if err := migrator.Up(ctx); err != nil {
		return err
	}
	return migrator.InstallGrants(ctx)
}

func integrationProviderCipher() *providerconfig.SecretCipher {
	cipher, err := providerconfig.NewSecretCipher(integrationEncryptionKey())
	if err != nil {
		panic(err)
	}
	return cipher
}

func requireSchema(t *testing.T, databaseURL string, keyring *providerconfig.Keyring) {
	t.Helper()
	if err := migrateSchema(t.Context(), databaseURL, keyring); err != nil {
		t.Fatalf("migrate execution-control schema: %v", err)
	}
}
