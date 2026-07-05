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
	runtimeModeCheck   = "check"
	runtimeModeInstall = "install"
)

var errInvalidOptions = errors.New("invalid personal memory runtime options")

type runtimeOptions struct {
	EvidencePath string
	Mode         string
	Now          time.Time
	Timeout      time.Duration
}

type runtimeReport struct {
	BaseURLConfigured bool   `json:"base_url_configured"`
	GeneratedAt       string `json:"generated_at"`
	Mode              string `json:"mode"`
	Passed            bool   `json:"passed"`
	RuntimeReady      bool   `json:"runtime_ready"`
	Store             string `json:"store"`
}

func main() {
	options, err := parseOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	report, err := runRuntimeCommand(context.Background(), options)
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

func parseOptions(args []string) (runtimeOptions, error) {
	flags := flag.NewFlagSet("personal-memory-runtime", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var options runtimeOptions
	timeoutSeconds := 30
	flags.StringVar(&options.EvidencePath, "evidence-path", "", "path to write personal memory runtime evidence JSON")
	flags.StringVar(&options.Mode, "mode", "", "runtime operation mode: install or check")
	flags.IntVar(&timeoutSeconds, "timeout-seconds", 30, "runtime operation timeout in seconds")
	if err := flags.Parse(args); err != nil {
		return runtimeOptions{}, err
	}
	options.EvidencePath = strings.TrimSpace(options.EvidencePath)
	options.Mode = strings.TrimSpace(options.Mode)
	if options.Mode == "" {
		return runtimeOptions{}, fmt.Errorf("%w: --mode is required", errInvalidOptions)
	}
	if options.Mode != runtimeModeInstall && options.Mode != runtimeModeCheck {
		return runtimeOptions{}, fmt.Errorf("%w: --mode must be install or check", errInvalidOptions)
	}
	if options.EvidencePath == "" {
		return runtimeOptions{}, fmt.Errorf("%w: --evidence-path is required", errInvalidOptions)
	}
	if timeoutSeconds <= 0 {
		return runtimeOptions{}, fmt.Errorf("%w: --timeout-seconds must be positive", errInvalidOptions)
	}
	options.Timeout = time.Duration(timeoutSeconds) * time.Second
	return options, nil
}

func runRuntimeCommand(ctx context.Context, options runtimeOptions) (runtimeReport, error) {
	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	cfg, err := config.LoadFromEnvForRole("personal-memory-runtime")
	if err != nil {
		return runtimeReport{}, err
	}
	if options.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, options.Timeout)
		defer cancel()
	}
	if options.Mode == runtimeModeInstall {
		if err := httpapi.EnsurePersonalMemoryRuntime(ctx, cfg); err != nil {
			return runtimeReport{}, err
		}
	}
	if err := httpapi.CheckPersonalMemoryRuntime(ctx, cfg); err != nil {
		return runtimeReport{}, err
	}

	report := runtimeReport{
		BaseURLConfigured: cfg.PersonalMemoryBaseURL != "",
		GeneratedAt:       now.Format(time.RFC3339Nano),
		Mode:              options.Mode,
		Passed:            true,
		RuntimeReady:      true,
		Store:             "hindsight",
	}
	if err := writeRuntimeReport(options.EvidencePath, report); err != nil {
		return runtimeReport{}, err
	}
	return report, nil
}

func writeRuntimeReport(path string, report runtimeReport) error {
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(bytes.TrimSpace(encoded), '\n'), 0o644)
}
