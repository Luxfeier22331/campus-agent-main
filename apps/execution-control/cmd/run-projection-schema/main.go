package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	databaseConnectAttemptTimeout = 5 * time.Second
	databaseStartupRetryDelay     = 500 * time.Millisecond
	databaseStartupTimeout        = 60 * time.Second
	schemaModeCheck               = "check"
	schemaModeInstall             = "install"
)

var errInvalidOptions = errors.New("invalid run projection schema options")

type schemaOptions struct {
	DatabaseURL  string
	EvidencePath string
	KeyringPath  string
	Mode         string
	Now          time.Time
}

type schemaReport struct {
	GeneratedAt string `json:"generated_at"`
	Mode        string `json:"mode"`
	Passed      bool   `json:"passed"`
	SchemaReady bool   `json:"schema_ready"`
	Store       string `json:"store"`
}

type postgresProbe func(context.Context, *pgx.ConnConfig) error

type databaseStartupPolicy struct {
	AttemptTimeout time.Duration
	RetryDelay     time.Duration
	Timeout        time.Duration
}

var defaultDatabaseStartupPolicy = databaseStartupPolicy{
	AttemptTimeout: databaseConnectAttemptTimeout,
	RetryDelay:     databaseStartupRetryDelay,
	Timeout:        databaseStartupTimeout,
}

func main() {
	options, err := parseOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	report, err := runSchemaCommand(context.Background(), options)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(encoded))
}

func parseOptions(args []string) (schemaOptions, error) {
	flags := flag.NewFlagSet("run-projection-schema", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var options schemaOptions
	flags.StringVar(&options.DatabaseURL, "database-url", "", "explicit Postgres run projection database URL")
	flags.StringVar(&options.EvidencePath, "evidence-path", "", "path to write run projection schema evidence JSON")
	flags.StringVar(&options.KeyringPath, "provider-config-keyring-path", "", "provider config keyring path")
	flags.StringVar(&options.Mode, "mode", "", "schema operation mode: install or check")
	if err := flags.Parse(args); err != nil {
		return schemaOptions{}, err
	}
	options.DatabaseURL = strings.TrimSpace(options.DatabaseURL)
	options.EvidencePath = strings.TrimSpace(options.EvidencePath)
	options.KeyringPath = strings.TrimSpace(options.KeyringPath)
	options.Mode = strings.TrimSpace(options.Mode)
	if options.Mode == "" {
		return schemaOptions{}, fmt.Errorf("%w: --mode is required", errInvalidOptions)
	}
	if options.Mode != schemaModeInstall && options.Mode != schemaModeCheck {
		return schemaOptions{}, fmt.Errorf("%w: --mode must be install or check", errInvalidOptions)
	}
	if options.DatabaseURL == "" {
		var err error
		options.DatabaseURL, err = postgresURLFromEnvironment(os.Getenv)
		if err != nil {
			return schemaOptions{}, fmt.Errorf("%w: %v", errInvalidOptions, err)
		}
	}
	if options.EvidencePath == "" {
		return schemaOptions{}, fmt.Errorf("%w: --evidence-path is required", errInvalidOptions)
	}
	return options, nil
}

func postgresURLFromEnvironment(getenv func(string) string) (string, error) {
	host := strings.TrimSpace(getenv("PGHOST"))
	database := strings.TrimSpace(getenv("PGDATABASE"))
	user := strings.TrimSpace(getenv("PGUSER"))
	password := getenv("PGPASSWORD")
	if host == "" || database == "" || user == "" || password == "" {
		return "", fmt.Errorf("--database-url or PGHOST, PGDATABASE, PGUSER, and PGPASSWORD is required")
	}
	port := strings.TrimSpace(getenv("PGPORT"))
	if port == "" {
		port = "5432"
	}
	databaseURL := &url.URL{
		Scheme: "postgresql",
		Host:   net.JoinHostPort(host, port),
		Path:   "/" + database,
		User:   url.UserPassword(user, password),
	}
	query := databaseURL.Query()
	if sslMode := strings.TrimSpace(getenv("PGSSLMODE")); sslMode != "" {
		query.Set("sslmode", sslMode)
	}
	if sslRootCert := strings.TrimSpace(getenv("PGSSLROOTCERT")); sslRootCert != "" {
		query.Set("sslrootcert", sslRootCert)
	}
	databaseURL.RawQuery = query.Encode()
	return databaseURL.String(), nil
}

func runSchemaCommand(ctx context.Context, options schemaOptions) (schemaReport, error) {
	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if err := waitForDatabase(
		ctx,
		options.DatabaseURL,
		defaultDatabaseStartupPolicy,
		probePostgres,
	); err != nil {
		return schemaReport{}, err
	}
	store, err := execution.NewPostgresRunProjectionStore(ctx, execution.PostgresRunProjectionStoreOptions{
		DatabaseURL: options.DatabaseURL,
		AutoMigrate: false,
	})
	if err != nil {
		return schemaReport{}, err
	}
	defer store.Close()
	memoryStore, err := memoryruntime.NewPostgresStateStore(ctx, memoryruntime.PostgresStateStoreOptions{
		DatabaseURL: options.DatabaseURL,
		AutoMigrate: false,
	})
	if err != nil {
		return schemaReport{}, err
	}
	defer memoryStore.Close()

	if options.Mode == schemaModeInstall {
		if err := store.EnsureSchema(ctx); err != nil {
			return schemaReport{}, err
		}
		if err := memoryStore.EnsureSchema(ctx); err != nil {
			return schemaReport{}, err
		}
		if err := store.InstallRuntimeRoleGrants(ctx); err != nil {
			return schemaReport{}, err
		}
		var keyring *providerconfig.Keyring
		if options.KeyringPath != "" {
			keyring, err = providerconfig.LoadKeyring(options.KeyringPath)
			if err != nil {
				return schemaReport{}, err
			}
		}
		if err := providerconfig.InstallDatabaseSchema(ctx, options.DatabaseURL, keyring); err != nil {
			return schemaReport{}, err
		}
	}
	if err := store.HealthCheck(ctx); err != nil {
		return schemaReport{}, err
	}
	if err := memoryStore.HealthCheck(ctx); err != nil {
		return schemaReport{}, err
	}
	if err := store.CheckRuntimeRoleGrants(ctx); err != nil {
		return schemaReport{}, err
	}
	if err := providerconfig.CheckDatabaseSchema(ctx, options.DatabaseURL); err != nil {
		return schemaReport{}, err
	}

	report := schemaReport{
		GeneratedAt: now.Format(time.RFC3339Nano),
		Mode:        options.Mode,
		Passed:      true,
		SchemaReady: true,
		Store:       "postgres",
	}
	if err := writeSchemaReport(options.EvidencePath, report); err != nil {
		return schemaReport{}, err
	}
	return report, nil
}

func waitForDatabase(
	ctx context.Context,
	databaseURL string,
	policy databaseStartupPolicy,
	probe postgresProbe,
) error {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("parse schema database url: %w", err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, policy.Timeout)
	defer cancel()

	for attempt := 1; ; attempt++ {
		attemptCtx, cancelAttempt := context.WithTimeout(waitCtx, policy.AttemptTimeout)
		err = probe(attemptCtx, config.Copy())
		cancelAttempt()
		if err == nil {
			return nil
		}
		if waitCtx.Err() != nil {
			return fmt.Errorf(
				"wait for schema database after %d attempt(s): %w; last connection error: %v",
				attempt,
				waitCtx.Err(),
				err,
			)
		}
		if !isRetryableDatabaseStartupError(err) {
			return fmt.Errorf("connect to schema database: %w", err)
		}

		timer := time.NewTimer(policy.RetryDelay)
		select {
		case <-waitCtx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return fmt.Errorf(
				"wait for schema database after %d attempt(s): %w; last connection error: %v",
				attempt,
				waitCtx.Err(),
				err,
			)
		case <-timer.C:
		}
	}
}

func probePostgres(ctx context.Context, config *pgx.ConnConfig) error {
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return err
	}
	return connection.Close(ctx)
}

func isRetryableDatabaseStartupError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		return strings.HasPrefix(postgresError.Code, "08") ||
			postgresError.Code == "53300" ||
			postgresError.Code == "57P03"
	}
	var networkError net.Error
	return errors.As(err, &networkError)
}

func writeSchemaReport(path string, report schemaReport) error {
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(bytes.TrimSpace(encoded), '\n'), 0o644)
}
