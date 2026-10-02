//go:build postgres_integration

package postgres_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
)

const (
	postgresImage     = "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
	adminUser         = "postgres"
	adminPassword     = "postgres-integration-admin"
	ownerRole         = "campus_agent"
	ownerPassword     = "campus-agent-password"
	executionRole     = "execution_control"
	executionPassword = "execution-control-password"
	appAPIRole        = "app_api"
	opsWebRole        = "ops_web"
	opsWebPassword    = "ops-web-password"
	modelConfigRole   = "model_config"
)

type postgresHarness struct {
	adminURL       string
	repositoryRoot string
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
	harness := &postgresHarness{adminURL: adminURL, repositoryRoot: repositoryRoot(t)}

	harness.installClusterRoles(t)
	t.Run("independent API instances", func(t *testing.T) { testAPIInstances(t, harness) })
	t.Run("campus search diagnostics", func(t *testing.T) { testCampusSearchDiagnostics(t, harness) })
	t.Run("run projection store", func(t *testing.T) {
		testRunProjectionStore(t, harness)
	})
	t.Run("run projection finalization", func(t *testing.T) {
		testRunProjectionFinalizationStore(t, harness)
	})
	t.Run("personal memory state store", func(t *testing.T) {
		testPersonalMemoryStateStore(t, harness)
	})
	t.Run("personal memory concurrent state store", func(t *testing.T) {
		testPersonalMemoryConcurrentStateStore(t, harness)
	})
	t.Run("agent invocation receipt", func(t *testing.T) {
		testAgentInvocationReceipt(t, harness)
	})
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve integration test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(source), "..", "..", "..", ".."))
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
		fmt.Sprintf("create role %s nologin", pgx.Identifier{modelConfigRole}.Sanitize()),
		"create role product_data_ro nologin",
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

func requireSchema(t *testing.T, databaseURL string) {
	t.Helper()
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse schema database URL: %v", err)
	}
	password, ok := parsed.User.Password()
	if !ok {
		t.Fatal("schema database URL is missing a password")
	}
	command := exec.CommandContext(t.Context(), "pnpm", "--dir", "jobs/campus-agent-schema", "migrate")
	command.Dir = repositoryRoot(t)
	command.Env = append(os.Environ(),
		"PGHOST="+parsed.Hostname(),
		"PGPORT="+parsed.Port(),
		"PGDATABASE="+strings.TrimPrefix(parsed.Path, "/"),
		"PGUSER="+parsed.User.Username(),
		"PGPASSWORD="+password,
		"PGSSLMODE=disable",
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("migrate execution-control schema with campus-agent-schema: %v\n%s", err, output)
	}
}
