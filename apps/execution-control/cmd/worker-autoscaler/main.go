package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/autoscaler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type commandOptions struct {
	appAPIBaseURL           string
	composeProjectDirectory string
	composeProjectName      string
	cooldownSeconds         int
	mode                    string
	scaleDownWindows        int
	scaleUpBacklogThreshold int
	scaleUpOldestAgeMS      int
	scaleUpWindows          int
	sharedSecret            string
	snapshotLimit           int
	timeout                 time.Duration
	workflowTaskQueue       string
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	options, err := parseOptions(args)
	if err != nil {
		return err
	}
	ctx := context.Background()
	appAPI := autoscaler.AppAPIClient{
		BaseURL:      options.appAPIBaseURL,
		SharedSecret: options.sharedSecret,
		Timeout:      options.timeout,
	}
	compose := autoscaler.DockerComposeActuator{
		ProjectDirectory: options.composeProjectDirectory,
		ProjectName:      options.composeProjectName,
	}
	_, err = autoscaler.Controller{
		Actuator:         compose,
		ActuationSource:  appAPI,
		Mode:             options.mode,
		ReplicaSource:    compose,
		RuntimePublisher: appAPI,
		ServicePolicies:  defaultServicePolicies(options.workflowTaskQueue, options),
		SnapshotLimit:    options.snapshotLimit,
		SnapshotSource:   appAPI,
	}.Run(ctx)
	return err
}

func parseOptions(args []string) (commandOptions, error) {
	options := commandOptions{
		appAPIBaseURL:           strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_APP_API_BASE_URL")),
		composeProjectDirectory: strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY")),
		composeProjectName:      strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_COMPOSE_PROJECT_NAME")),
		cooldownSeconds:         180,
		mode:                    strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_WORKER_AUTOSCALER_MODE")),
		scaleDownWindows:        6,
		scaleUpBacklogThreshold: 8,
		scaleUpOldestAgeMS:      30_000,
		scaleUpWindows:          2,
		sharedSecret:            strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET")),
		snapshotLimit:           32,
		timeout:                 5 * time.Second,
		workflowTaskQueue: strings.TrimSpace(
			os.Getenv("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE"),
		),
	}
	if options.workflowTaskQueue == "" {
		options.workflowTaskQueue = temporalruntime.WorkflowTaskQueue
	}
	if err := loadPolicyEnvInts(&options); err != nil {
		return commandOptions{}, err
	}
	if options.mode == "" {
		options.mode = autoscaler.ModeDryRun
	}

	flags := flag.NewFlagSet("worker-autoscaler", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	timeoutMS := int(options.timeout / time.Millisecond)
	flags.StringVar(&options.appAPIBaseURL, "app-api-base-url", options.appAPIBaseURL, "app-api base URL")
	flags.StringVar(&options.composeProjectDirectory, "compose-project-directory", options.composeProjectDirectory, "docker compose project directory")
	flags.StringVar(&options.composeProjectName, "compose-project-name", options.composeProjectName, "docker compose project name")
	flags.IntVar(&options.cooldownSeconds, "cooldown-seconds", options.cooldownSeconds, "seconds to hold scale changes after a recent actuation")
	flags.StringVar(&options.mode, "mode", options.mode, "autoscaler mode: dry-run or apply")
	flags.IntVar(&options.scaleDownWindows, "scale-down-windows", options.scaleDownWindows, "consecutive idle windows before scale down")
	flags.IntVar(&options.scaleUpBacklogThreshold, "scale-up-backlog-threshold", options.scaleUpBacklogThreshold, "observed backlog count threshold before scale up")
	flags.IntVar(&options.scaleUpOldestAgeMS, "scale-up-oldest-age-ms", options.scaleUpOldestAgeMS, "observed oldest task age threshold before scale up")
	flags.IntVar(&options.scaleUpWindows, "scale-up-windows", options.scaleUpWindows, "consecutive hot windows before scale up")
	flags.StringVar(&options.sharedSecret, "shared-secret", options.sharedSecret, "app-api internal shared secret")
	flags.IntVar(&options.snapshotLimit, "snapshot-limit", options.snapshotLimit, "number of latest task queue snapshots to read")
	flags.IntVar(&timeoutMS, "timeout-ms", timeoutMS, "app-api request timeout in milliseconds")
	flags.StringVar(&options.workflowTaskQueue, "workflow-task-queue", options.workflowTaskQueue, "Temporal workflow task queue")
	if err := flags.Parse(args); err != nil {
		return commandOptions{}, err
	}
	options.mode = strings.TrimSpace(options.mode)
	if options.mode == "dry_run" {
		options.mode = "dry-run"
	}
	if options.mode != autoscaler.ModeDryRun && options.mode != autoscaler.ModeApply {
		return commandOptions{}, fmt.Errorf("mode must be dry-run or apply")
	}
	options.timeout = time.Duration(timeoutMS) * time.Millisecond
	if options.timeout <= 0 {
		return commandOptions{}, errors.New("timeout-ms must be positive")
	}
	if options.cooldownSeconds < 0 {
		return commandOptions{}, errors.New("cooldown-seconds must be non-negative")
	}
	if options.scaleDownWindows <= 0 {
		return commandOptions{}, errors.New("scale-down-windows must be positive")
	}
	if options.scaleUpBacklogThreshold <= 0 {
		return commandOptions{}, errors.New("scale-up-backlog-threshold must be positive")
	}
	if options.scaleUpOldestAgeMS <= 0 {
		return commandOptions{}, errors.New("scale-up-oldest-age-ms must be positive")
	}
	if options.scaleUpWindows <= 0 {
		return commandOptions{}, errors.New("scale-up-windows must be positive")
	}
	if options.snapshotLimit < len(defaultServicePolicies(options.workflowTaskQueue)) {
		return commandOptions{}, fmt.Errorf("snapshot-limit must cover all autoscaled services")
	}
	missing := []string{}
	if strings.TrimSpace(options.appAPIBaseURL) == "" {
		missing = append(missing, "app-api-base-url")
	}
	if strings.TrimSpace(options.sharedSecret) == "" {
		missing = append(missing, "shared-secret")
	}
	if strings.TrimSpace(options.composeProjectName) == "" {
		missing = append(missing, "compose-project-name")
	}
	if strings.TrimSpace(options.composeProjectDirectory) == "" {
		missing = append(missing, "compose-project-directory")
	}
	if len(missing) > 0 {
		return commandOptions{}, fmt.Errorf("%s required", strings.Join(missing, ", "))
	}
	return options, nil
}

func loadPolicyEnvInts(options *commandOptions) error {
	values := []struct {
		name   string
		target *int
	}{
		{"EXECUTION_CONTROL_WORKER_AUTOSCALER_COOLDOWN_SECONDS", &options.cooldownSeconds},
		{"EXECUTION_CONTROL_WORKER_AUTOSCALER_SCALE_DOWN_WINDOWS", &options.scaleDownWindows},
		{"EXECUTION_CONTROL_WORKER_AUTOSCALER_SCALE_UP_BACKLOG_THRESHOLD", &options.scaleUpBacklogThreshold},
		{"EXECUTION_CONTROL_WORKER_AUTOSCALER_SCALE_UP_OLDEST_AGE_MS", &options.scaleUpOldestAgeMS},
		{"EXECUTION_CONTROL_WORKER_AUTOSCALER_SCALE_UP_WINDOWS", &options.scaleUpWindows},
	}
	for _, value := range values {
		parsed, err := envInt(value.name)
		if err != nil {
			return err
		}
		if parsed != nil {
			*value.target = *parsed
		}
	}
	return nil
}

func envInt(name string) (*int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return nil, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return nil, fmt.Errorf("%s must be an integer", name)
	}
	return &parsed, nil
}

func defaultServicePolicies(workflowTaskQueue string, input ...commandOptions) map[string]autoscaler.ServicePolicy {
	workflowQueue := strings.TrimSpace(workflowTaskQueue)
	if workflowQueue == "" {
		workflowQueue = temporalruntime.WorkflowTaskQueue
	}
	policyInput := commandOptions{
		cooldownSeconds:         180,
		scaleDownWindows:        6,
		scaleUpBacklogThreshold: 8,
		scaleUpOldestAgeMS:      30_000,
		scaleUpWindows:          2,
	}
	if len(input) > 0 {
		policyInput = input[0]
	}
	common := func(maxReplicas int, taskQueue string) autoscaler.ServicePolicy {
		return autoscaler.ServicePolicy{
			CooldownSeconds:             policyInput.cooldownSeconds,
			MaxReplicas:                 maxReplicas,
			MinReplicas:                 1,
			ScaleDownConsecutiveWindows: policyInput.scaleDownWindows,
			ScaleUpBacklogThreshold:     policyInput.scaleUpBacklogThreshold,
			ScaleUpConsecutiveWindows:   policyInput.scaleUpWindows,
			ScaleUpOldestAgeThresholdMS: policyInput.scaleUpOldestAgeMS,
			TaskQueue:                   taskQueue,
		}
	}
	return map[string]autoscaler.ServicePolicy{
		"workflow-worker":       common(3, workflowQueue),
		"activity-worker-core":  common(3, temporalruntime.ActivityTaskQueueCore),
		"activity-worker-agent": common(3, temporalruntime.ActivityTaskQueueAgent),
	}
}
