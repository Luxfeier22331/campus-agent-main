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

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

var (
	errTemporalReadyzBlocked = errors.New("temporal readyz blocked")
	errInvalidOptions        = errors.New("invalid temporal runtime HTTP check options")
)

var requiredTemporalTaskQueues = []string{
	temporalruntime.WorkflowTaskQueue,
	temporalruntime.ActivityTaskQueueCore,
	temporalruntime.ActivityTaskQueueAgent,
	temporalruntime.ActivityTaskQueueKnowledge,
}

type checkOptions struct {
	EvidencePath string
	GatewayURL   string
	Now          time.Time
	SharedSecret string
	Timeout      time.Duration
}

type checkReport struct {
	ExecutionControlURL string       `json:"execution_control_url"`
	GeneratedAt         string       `json:"generated_at"`
	Passed              bool         `json:"passed"`
	Readyz              readyzReport `json:"readyz"`
}

type readyzReport struct {
	RunProjectionStore runProjectionStoreStatus `json:"run_projection_store"`
	Status             string                   `json:"status"`
	TemporalRuntime    temporalRuntimeStatus    `json:"temporal_runtime"`
}

type runProjectionStoreStatus struct {
	Configured bool `json:"configured"`
	Healthy    bool `json:"healthy"`
}

type temporalRuntimeStatus struct {
	Configured bool     `json:"configured"`
	Healthy    bool     `json:"healthy"`
	LastError  string   `json:"last_error"`
	Namespace  string   `json:"namespace"`
	TaskQueue  string   `json:"task_queue"`
	TaskQueues []string `json:"task_queues"`
	WorkerID   string   `json:"worker_id"`
}

func main() {
	options, err := parseOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	report, err := runCheck(context.Background(), options)
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

func parseOptions(args []string) (checkOptions, error) {
	flags := flag.NewFlagSet("temporal-runtime-http-check", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var timeoutMS int
	var options checkOptions
	flags.StringVar(&options.EvidencePath, "evidence-path", "", "path to write Temporal runtime HTTP check closeout JSON")
	flags.StringVar(&options.GatewayURL, "execution-control-url", "", "deployed execution-control base URL")
	flags.StringVar(&options.SharedSecret, "shared-secret", "", "execution-control internal shared secret")
	flags.IntVar(&timeoutMS, "timeout-ms", 8000, "HTTP check timeout in milliseconds")
	if err := flags.Parse(args); err != nil {
		return checkOptions{}, err
	}
	options.EvidencePath = strings.TrimSpace(options.EvidencePath)
	options.GatewayURL = strings.TrimRight(strings.TrimSpace(options.GatewayURL), "/")
	options.SharedSecret = strings.TrimSpace(options.SharedSecret)
	options.Timeout = time.Duration(timeoutMS) * time.Millisecond
	if options.GatewayURL == "" {
		return checkOptions{}, fmt.Errorf("%w: --execution-control-url is required", errInvalidOptions)
	}
	if _, err := url.ParseRequestURI(options.GatewayURL); err != nil {
		return checkOptions{}, fmt.Errorf("%w: --execution-control-url must be an absolute URL", errInvalidOptions)
	}
	if options.SharedSecret == "" {
		return checkOptions{}, fmt.Errorf("%w: --shared-secret is required", errInvalidOptions)
	}
	if options.EvidencePath == "" {
		return checkOptions{}, fmt.Errorf("%w: --evidence-path is required", errInvalidOptions)
	}
	if options.Timeout <= 0 {
		return checkOptions{}, fmt.Errorf("%w: --timeout-ms must be positive", errInvalidOptions)
	}
	return options, nil
}

func runCheck(ctx context.Context, options checkOptions) (checkReport, error) {
	if options.Timeout <= 0 {
		options.Timeout = 8 * time.Second
	}
	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	readyz, err := probeReadyz(ctx, options)
	if err != nil {
		return checkReport{}, err
	}
	if err := requireDurableReadyz(readyz); err != nil {
		return checkReport{}, err
	}
	report := checkReport{
		ExecutionControlURL: options.GatewayURL,
		GeneratedAt:         now.Format(time.RFC3339Nano),
		Passed:              true,
		Readyz:              readyz,
	}
	if err := writeReport(options.EvidencePath, report); err != nil {
		return checkReport{}, err
	}
	return report, nil
}

func probeReadyz(ctx context.Context, options checkOptions) (readyzReport, error) {
	probeCtx, cancel := context.WithTimeout(ctx, options.Timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(
		probeCtx,
		http.MethodGet,
		options.GatewayURL+"/readyz",
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
	defer func() {
		_ = response.Body.Close()
	}()
	if response.StatusCode != http.StatusOK {
		return readyzReport{}, fmt.Errorf("%w: execution-control readyz returned HTTP %d", errTemporalReadyzBlocked, response.StatusCode)
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
		return fmt.Errorf("%w: status=%s", errTemporalReadyzBlocked, report.Status)
	case !report.RunProjectionStore.Configured || !report.RunProjectionStore.Healthy:
		return fmt.Errorf("%w: run_projection_store is not configured and healthy", errTemporalReadyzBlocked)
	case !report.TemporalRuntime.Configured || !report.TemporalRuntime.Healthy:
		return fmt.Errorf("%w: temporal_runtime is not configured and healthy", errTemporalReadyzBlocked)
	case strings.TrimSpace(report.TemporalRuntime.Namespace) == "":
		return fmt.Errorf("%w: temporal namespace is empty", errTemporalReadyzBlocked)
	case strings.TrimSpace(report.TemporalRuntime.TaskQueue) == "":
		return fmt.Errorf("%w: temporal task queue is empty", errTemporalReadyzBlocked)
	case !containsAllTaskQueues(report.TemporalRuntime.TaskQueues, requiredTemporalTaskQueues):
		return fmt.Errorf("%w: temporal required task queues are incomplete", errTemporalReadyzBlocked)
	case strings.TrimSpace(report.TemporalRuntime.WorkerID) == "":
		return fmt.Errorf("%w: temporal worker identity is empty", errTemporalReadyzBlocked)
	}
	return nil
}

func containsAllTaskQueues(actual []string, required []string) bool {
	seen := map[string]bool{}
	for _, queue := range actual {
		seen[strings.TrimSpace(queue)] = true
	}
	for _, queue := range required {
		if !seen[queue] {
			return false
		}
	}
	return true
}

func writeReport(path string, report checkReport) error {
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(bytes.TrimSpace(encoded), '\n'), 0o644)
}
