package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalmetrics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type options struct {
	appAPIBaseURL     string
	namespace         string
	sharedSecret      string
	temporalAddr      string
	timeout           time.Duration
	workerID          string
	workflowTaskQueue string
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	opts, err := parseOptions(args)
	if err != nil {
		return err
	}
	ctx := context.Background()
	temporalClient, err := temporalruntime.NewTemporalClient(
		ctx,
		opts.temporalAddr,
		opts.namespace,
		opts.workerID,
	)
	if err != nil {
		return err
	}
	defer temporalClient.Close()
	sampler := temporalmetrics.Sampler{
		Client:    temporalmetrics.SDKTaskQueueClient{Client: temporalClient, Namespace: opts.namespace},
		Namespace: opts.namespace,
		TaskQueues: []temporalmetrics.TaskQueueTarget{
			{Name: opts.workflowTaskQueue, Kind: temporalmetrics.TaskQueueKindWorkflow},
			{Name: temporalruntime.ActivityTaskQueueCore, Kind: temporalmetrics.TaskQueueKindActivity},
			{Name: temporalruntime.ActivityTaskQueueAgent, Kind: temporalmetrics.TaskQueueKindActivity},
			{Name: temporalruntime.ActivityTaskQueueKnowledge, Kind: temporalmetrics.TaskQueueKindActivity},
		},
	}
	payload, err := sampler.Sample(ctx)
	if err != nil {
		return err
	}
	return temporalmetrics.Publisher{
		BaseURL:      opts.appAPIBaseURL,
		SharedSecret: opts.sharedSecret,
		Timeout:      opts.timeout,
	}.Publish(ctx, payload)
}

func parseOptions(args []string) (options, error) {
	opts := options{
		appAPIBaseURL: strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_APP_API_BASE_URL")),
		namespace:     strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE")),
		sharedSecret:  strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET")),
		temporalAddr:  strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS")),
		timeout:       5 * time.Second,
		workerID:      strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY")),
		workflowTaskQueue: strings.TrimSpace(
			os.Getenv("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE"),
		),
	}
	if opts.workflowTaskQueue == "" {
		opts.workflowTaskQueue = temporalruntime.WorkflowTaskQueue
	}
	flags := flag.NewFlagSet("temporal-task-queue-sampler", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	timeoutMS := 5000
	flags.StringVar(&opts.appAPIBaseURL, "app-api-base-url", opts.appAPIBaseURL, "app-api base URL")
	flags.StringVar(&opts.namespace, "temporal-namespace", opts.namespace, "Temporal namespace")
	flags.StringVar(&opts.sharedSecret, "shared-secret", opts.sharedSecret, "app-api internal shared secret")
	flags.StringVar(&opts.temporalAddr, "temporal-address", opts.temporalAddr, "Temporal address")
	flags.IntVar(&timeoutMS, "timeout-ms", timeoutMS, "app-api publish timeout in milliseconds")
	flags.StringVar(&opts.workerID, "worker-id", opts.workerID, "Temporal client identity")
	flags.StringVar(&opts.workflowTaskQueue, "workflow-task-queue", opts.workflowTaskQueue, "Temporal workflow task queue")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	opts.timeout = time.Duration(timeoutMS) * time.Millisecond
	missing := []string{}
	if strings.TrimSpace(opts.temporalAddr) == "" {
		missing = append(missing, "temporal-address")
	}
	if strings.TrimSpace(opts.namespace) == "" {
		missing = append(missing, "temporal-namespace")
	}
	if strings.TrimSpace(opts.appAPIBaseURL) == "" {
		missing = append(missing, "app-api-base-url")
	}
	if strings.TrimSpace(opts.sharedSecret) == "" {
		missing = append(missing, "shared-secret")
	}
	if strings.TrimSpace(opts.workflowTaskQueue) == "" {
		missing = append(missing, "workflow-task-queue")
	}
	if opts.timeout <= 0 {
		return options{}, errors.New("timeout-ms must be positive")
	}
	if len(missing) > 0 {
		return options{}, fmt.Errorf("%s required", strings.Join(missing, ", "))
	}
	return opts, nil
}
