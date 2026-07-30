package main

import (
	"context"
	"crypto/x509"
	"errors"
	"net"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestParseOptionsRequiresModeDatabaseURLAndEvidencePath(t *testing.T) {
	for _, key := range []string{"PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"} {
		t.Setenv(key, "")
	}
	_, err := parseOptions([]string{
		"--mode", "check",
		"--database-url", "postgres://example",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing evidence path error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--mode", "check",
		"--evidence-path", "schema.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing database url error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--database-url", "postgres://example",
		"--evidence-path", "schema.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing mode error = %v, want errInvalidOptions", err)
	}
}

func TestParseOptionsBuildsSchemaOwnerURLFromStandardPostgresEnvironment(t *testing.T) {
	t.Setenv("PGHOST", "postgres.internal")
	t.Setenv("PGPORT", "5433")
	t.Setenv("PGDATABASE", "campus agent")
	t.Setenv("PGUSER", "schema-owner")
	t.Setenv("PGPASSWORD", "secret:/ value")
	t.Setenv("PGSSLMODE", "verify-full")
	t.Setenv("PGSSLROOTCERT", "/etc/postgres/ca.crt")
	options, err := parseOptions([]string{"--mode", "check", "--evidence-path", "schema.json"})
	if err != nil {
		t.Fatalf("parse schema owner environment: %v", err)
	}
	parsed, err := url.Parse(options.DatabaseURL)
	if err != nil {
		t.Fatalf("parse resolved database URL: %v", err)
	}
	if parsed.Host != "postgres.internal:5433" || parsed.Path != "/campus agent" {
		t.Fatalf("resolved database URL = %s", parsed.Redacted())
	}
	if password, _ := parsed.User.Password(); parsed.User.Username() != "schema-owner" || password != "secret:/ value" {
		t.Fatalf("resolved credentials were not URL encoded")
	}
	if parsed.Query().Get("sslmode") != "verify-full" || parsed.Query().Get("sslrootcert") != "/etc/postgres/ca.crt" {
		t.Fatalf("resolved TLS query = %v", parsed.Query())
	}
}

func TestParseOptionsRejectsUnknownMode(t *testing.T) {
	_, err := parseOptions([]string{
		"--mode", "repair",
		"--database-url", "postgres://example",
		"--evidence-path", "schema.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse unknown mode error = %v, want errInvalidOptions", err)
	}
}

func TestWaitForDatabaseRetriesTransientConnectionErrors(t *testing.T) {
	attempts := 0
	err := waitForDatabase(
		t.Context(),
		"postgresql://owner:secret@example.test/campus",
		databaseStartupPolicy{
			AttemptTimeout: 50 * time.Millisecond,
			RetryDelay:     time.Millisecond,
			Timeout:        100 * time.Millisecond,
		},
		func(context.Context, *pgx.ConnConfig) error {
			attempts++
			if attempts == 1 {
				return &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")}
			}
			return nil
		},
	)
	if err != nil {
		t.Fatalf("waitForDatabase returned error: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("database probe attempts = %d, want 2", attempts)
	}
}

func TestWaitForDatabaseRejectsPermanentConnectionErrors(t *testing.T) {
	attempts := 0
	err := waitForDatabase(
		t.Context(),
		"postgresql://owner:secret@example.test/campus",
		databaseStartupPolicy{
			AttemptTimeout: 50 * time.Millisecond,
			RetryDelay:     time.Millisecond,
			Timeout:        100 * time.Millisecond,
		},
		func(context.Context, *pgx.ConnConfig) error {
			attempts++
			return &pgconn.PgError{Code: "28P01", Message: "password authentication failed"}
		},
	)
	if err == nil || !strings.Contains(err.Error(), "password authentication failed") {
		t.Fatalf("waitForDatabase error = %v, want authentication failure", err)
	}
	if attempts != 1 {
		t.Fatalf("database probe attempts = %d, want 1", attempts)
	}
}

func TestWaitForDatabaseStopsAtStartupDeadline(t *testing.T) {
	attempts := 0
	err := waitForDatabase(
		t.Context(),
		"postgresql://owner:secret@example.test/campus",
		databaseStartupPolicy{
			AttemptTimeout: 5 * time.Millisecond,
			RetryDelay:     time.Millisecond,
			Timeout:        15 * time.Millisecond,
		},
		func(ctx context.Context, _ *pgx.ConnConfig) error {
			attempts++
			<-ctx.Done()
			return ctx.Err()
		},
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waitForDatabase error = %v, want context deadline exceeded", err)
	}
	if attempts < 1 {
		t.Fatal("database probe was not attempted")
	}
}

func TestRetryableDatabaseStartupErrors(t *testing.T) {
	tests := []struct {
		err  error
		name string
		want bool
	}{
		{name: "connection exception", err: &pgconn.PgError{Code: "08006"}, want: true},
		{name: "cannot connect now", err: &pgconn.PgError{Code: "57P03"}, want: true},
		{name: "too many connections", err: &pgconn.PgError{Code: "53300"}, want: true},
		{
			name: "invalid tls certificate",
			err:  x509.UnknownAuthorityError{Cert: &x509.Certificate{}},
			want: false,
		},
		{name: "invalid catalog", err: &pgconn.PgError{Code: "3D000"}, want: false},
		{name: "insufficient privilege", err: &pgconn.PgError{Code: "42501"}, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isRetryableDatabaseStartupError(test.err); got != test.want {
				t.Fatalf("isRetryableDatabaseStartupError() = %t, want %t", got, test.want)
			}
		})
	}
}
