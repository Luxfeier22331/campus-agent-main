package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	errDurableReadyzBlocked = errors.New("durable readyz blocked")
	errInvalidOptions       = errors.New("invalid durable runtime http proof options")
)

type proofOptions struct {
	EvidencePath  string
	Now           time.Time
	SharedSecret  string
	SupervisorURL string
	Timeout       time.Duration
}

type proofReport struct {
	GeneratedAt   string       `json:"generated_at"`
	Passed        bool         `json:"passed"`
	Readyz        readyzReport `json:"readyz"`
	SupervisorURL string       `json:"supervisor_url"`
}

type readyzReport struct {
	DurableRecoveryLoop durableLoopStatus    `json:"durable_recovery_loop"`
	DurableRuntime      durableRuntimeStatus `json:"durable_runtime"`
	DurableWorkerLoop   durableLoopStatus    `json:"durable_worker_loop"`
	Status              string               `json:"status"`
}

type durableRuntimeStatus struct {
	Configured bool `json:"configured"`
	Healthy    bool `json:"healthy"`
}

type durableLoopStatus struct {
	Configured bool   `json:"configured"`
	Enabled    bool   `json:"enabled"`
	Healthy    bool   `json:"healthy"`
	Started    bool   `json:"started"`
	WorkerID   string `json:"worker_id,omitempty"`
}

func main() {
	options, err := parseOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	report, err := runProof(context.Background(), options)
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

func parseOptions(args []string) (proofOptions, error) {
	flags := flag.NewFlagSet("durable-runtime-http-proof", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var timeoutMS int
	var options proofOptions
	flags.StringVar(&options.EvidencePath, "evidence-path", "", "path to write durable runtime HTTP proof evidence JSON")
	flags.StringVar(&options.SharedSecret, "shared-secret", "", "supervisor internal worker shared secret")
	flags.StringVar(&options.SupervisorURL, "supervisor-url", "", "deployed supervisor base URL")
	flags.IntVar(&timeoutMS, "timeout-ms", 8000, "HTTP proof timeout in milliseconds")
	if err := flags.Parse(args); err != nil {
		return proofOptions{}, err
	}
	options.EvidencePath = strings.TrimSpace(options.EvidencePath)
	options.SharedSecret = strings.TrimSpace(options.SharedSecret)
	options.SupervisorURL = strings.TrimRight(strings.TrimSpace(options.SupervisorURL), "/")
	options.Timeout = time.Duration(timeoutMS) * time.Millisecond
	if options.SupervisorURL == "" {
		return proofOptions{}, fmt.Errorf("%w: --supervisor-url is required", errInvalidOptions)
	}
	if _, err := url.ParseRequestURI(options.SupervisorURL); err != nil {
		return proofOptions{}, fmt.Errorf("%w: --supervisor-url must be an absolute URL", errInvalidOptions)
	}
	if options.SharedSecret == "" {
		return proofOptions{}, fmt.Errorf("%w: --shared-secret is required", errInvalidOptions)
	}
	if options.EvidencePath == "" {
		return proofOptions{}, fmt.Errorf("%w: --evidence-path is required", errInvalidOptions)
	}
	if options.Timeout <= 0 {
		return proofOptions{}, fmt.Errorf("%w: --timeout-ms must be positive", errInvalidOptions)
	}
	return options, nil
}

func runProof(ctx context.Context, options proofOptions) (proofReport, error) {
	if options.Timeout <= 0 {
		options.Timeout = 8 * time.Second
	}
	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	readyz, err := probeReadyz(ctx, options)
	if err != nil {
		return proofReport{}, err
	}
	if err := requireDurableReadyz(readyz); err != nil {
		return proofReport{}, err
	}
	report := proofReport{
		GeneratedAt:   now.Format(time.RFC3339Nano),
		Passed:        true,
		Readyz:        readyz,
		SupervisorURL: options.SupervisorURL,
	}
	if err := writeReport(options.EvidencePath, report); err != nil {
		return proofReport{}, err
	}
	return report, nil
}

func probeReadyz(ctx context.Context, options proofOptions) (readyzReport, error) {
	probeCtx, cancel := context.WithTimeout(ctx, options.Timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(
		probeCtx,
		http.MethodGet,
		options.SupervisorURL+"/readyz",
		nil,
	)
	if err != nil {
		return readyzReport{}, err
	}
	request.Header.Set("x-worker-origin-auth", options.SharedSecret)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return readyzReport{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return readyzReport{}, fmt.Errorf("%w: supervisor readyz returned HTTP %d", errDurableReadyzBlocked, response.StatusCode)
	}
	var report readyzReport
	if err := json.NewDecoder(response.Body).Decode(&report); err != nil {
		return readyzReport{}, err
	}
	return report, nil
}

func requireDurableReadyz(report readyzReport) error {
	switch {
	case report.Status != "ready":
		return fmt.Errorf("%w: status=%s", errDurableReadyzBlocked, report.Status)
	case !report.DurableRuntime.Configured || !report.DurableRuntime.Healthy:
		return fmt.Errorf("%w: durable_runtime is not configured and healthy", errDurableReadyzBlocked)
	case !loopReady(report.DurableWorkerLoop):
		return fmt.Errorf("%w: durable_worker_loop is not enabled, configured, healthy, and started", errDurableReadyzBlocked)
	case !loopReady(report.DurableRecoveryLoop):
		return fmt.Errorf("%w: durable_recovery_loop is not enabled, configured, healthy, and started", errDurableReadyzBlocked)
	}
	return nil
}

func loopReady(status durableLoopStatus) bool {
	return status.Enabled && status.Configured && status.Healthy && status.Started
}

func writeReport(path string, report proofReport) error {
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(bytes.TrimSpace(encoded), '\n'), 0o644)
}
