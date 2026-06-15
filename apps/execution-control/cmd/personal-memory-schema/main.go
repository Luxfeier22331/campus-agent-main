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

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
)

const (
	schemaModeCheck   = "check"
	schemaModeInstall = "install"
)

var errInvalidOptions = errors.New("invalid personal memory schema options")

type schemaOptions struct {
	EvidencePath string
	Mode         string
	Now          time.Time
	Timeout      time.Duration
}

type schemaReport struct {
	Collection  string `json:"collection"`
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
	flags := flag.NewFlagSet("personal-memory-schema", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var options schemaOptions
	timeoutSeconds := 30
	flags.StringVar(&options.EvidencePath, "evidence-path", "", "path to write personal memory schema evidence JSON")
	flags.StringVar(&options.Mode, "mode", "", "schema operation mode: install or check")
	flags.IntVar(&timeoutSeconds, "timeout-seconds", 30, "schema operation timeout in seconds")
	if err := flags.Parse(args); err != nil {
		return schemaOptions{}, err
	}
	options.EvidencePath = strings.TrimSpace(options.EvidencePath)
	options.Mode = strings.TrimSpace(options.Mode)
	if options.Mode == "" {
		return schemaOptions{}, fmt.Errorf("%w: --mode is required", errInvalidOptions)
	}
	if options.Mode != schemaModeInstall && options.Mode != schemaModeCheck {
		return schemaOptions{}, fmt.Errorf("%w: --mode must be install or check", errInvalidOptions)
	}
	if options.EvidencePath == "" {
		return schemaOptions{}, fmt.Errorf("%w: --evidence-path is required", errInvalidOptions)
	}
	if timeoutSeconds <= 0 {
		return schemaOptions{}, fmt.Errorf("%w: --timeout-seconds must be positive", errInvalidOptions)
	}
	options.Timeout = time.Duration(timeoutSeconds) * time.Second
	return options, nil
}

func runSchemaCommand(ctx context.Context, options schemaOptions) (schemaReport, error) {
	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	cfg, err := config.LoadFromEnvForRole("activity-context")
	if err != nil {
		return schemaReport{}, err
	}
	if options.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, options.Timeout)
		defer cancel()
	}
	if options.Mode == schemaModeInstall {
		if err := httpapi.EnsurePersonalMemorySchema(ctx, cfg); err != nil {
			return schemaReport{}, err
		}
	}
	if err := httpapi.CheckPersonalMemorySchema(ctx, cfg); err != nil {
		return schemaReport{}, err
	}

	report := schemaReport{
		Collection:  cfg.PersonalMemoryCollection,
		GeneratedAt: now.Format(time.RFC3339Nano),
		Mode:        options.Mode,
		Passed:      true,
		SchemaReady: true,
		Store:       "qdrant",
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
