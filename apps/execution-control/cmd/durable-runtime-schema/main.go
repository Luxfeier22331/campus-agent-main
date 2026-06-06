package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

const (
	schemaModeCheck   = "check"
	schemaModeInstall = "install"
)

var errInvalidOptions = errors.New("invalid durable runtime schema options")

type schemaOptions struct {
	DatabaseURL  string
	EvidencePath string
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
	flags := flag.NewFlagSet("durable-runtime-schema", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var options schemaOptions
	flags.StringVar(&options.DatabaseURL, "database-url", "", "explicit Postgres durable runtime database URL")
	flags.StringVar(&options.EvidencePath, "evidence-path", "", "path to write durable runtime schema evidence JSON")
	flags.StringVar(&options.Mode, "mode", "", "schema operation mode: install or check")
	if err := flags.Parse(args); err != nil {
		return schemaOptions{}, err
	}
	options.DatabaseURL = strings.TrimSpace(options.DatabaseURL)
	options.EvidencePath = strings.TrimSpace(options.EvidencePath)
	options.Mode = strings.TrimSpace(options.Mode)
	if options.Mode == "" {
		return schemaOptions{}, fmt.Errorf("%w: --mode is required", errInvalidOptions)
	}
	if options.Mode != schemaModeInstall && options.Mode != schemaModeCheck {
		return schemaOptions{}, fmt.Errorf("%w: --mode must be install or check", errInvalidOptions)
	}
	if options.DatabaseURL == "" {
		return schemaOptions{}, fmt.Errorf("%w: --database-url is required", errInvalidOptions)
	}
	if options.EvidencePath == "" {
		return schemaOptions{}, fmt.Errorf("%w: --evidence-path is required", errInvalidOptions)
	}
	return options, nil
}

func runSchemaCommand(ctx context.Context, options schemaOptions) (schemaReport, error) {
	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	store, err := execution.NewPostgresDurableRuntimeStore(ctx, execution.PostgresDurableRuntimeStoreOptions{
		DatabaseURL: options.DatabaseURL,
		AutoMigrate: false,
	})
	if err != nil {
		return schemaReport{}, err
	}
	defer store.Close()

	if options.Mode == schemaModeInstall {
		if err := store.EnsureSchema(ctx); err != nil {
			return schemaReport{}, err
		}
	}
	if err := store.HealthCheck(ctx); err != nil {
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
