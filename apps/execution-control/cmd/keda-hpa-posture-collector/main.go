package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/autoscaler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/kedaposture"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type options struct {
	appAPIBaseURL       string
	allowInsecureTLS    bool
	kubernetesCAFile    string
	kubernetesRootCAs   *x509.CertPool
	kubernetesServerURL string
	namespace           string
	sharedSecret        string
	targets             []kedaposture.Target
	timeout             time.Duration
	token               string
	tokenFile           string
	workflowTaskQueue   string
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
	if options.allowInsecureTLS {
		options.kubernetesRootCAs = nil
	} else if strings.TrimSpace(options.kubernetesCAFile) != "" {
		certPool, err := caCertPool(options.kubernetesCAFile)
		if err != nil {
			return err
		}
		options.kubernetesRootCAs = certPool
	}
	kubernetesClient, appAPIClient := buildRuntimeClients(options)
	ctx := context.Background()
	postures, err := kedaposture.Collector{
		Client:    kubernetesClient,
		ServerURL: options.kubernetesServerURL,
		Token:     options.token,
	}.Collect(ctx, kedaposture.Config{
		Namespace: options.namespace,
		Targets:   options.targets,
	})
	if err != nil {
		return err
	}
	return autoscaler.AppAPIClient{
		BaseURL:      options.appAPIBaseURL,
		HTTPClient:   appAPIClient,
		SharedSecret: options.sharedSecret,
		Timeout:      options.timeout,
	}.PublishRuntimePayload(ctx, autoscaler.AppAPIRuntimePayload{
		Postures:      postures,
		SchemaVersion: autoscaler.SchemaVersion,
	})
}

func parseOptions(args []string) (options, error) {
	opts := options{
		appAPIBaseURL:       strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_APP_API_BASE_URL")),
		kubernetesCAFile:    strings.TrimSpace(os.Getenv("KEDA_HPA_POSTURE_KUBERNETES_CA_FILE")),
		kubernetesServerURL: strings.TrimSpace(os.Getenv("KEDA_HPA_POSTURE_KUBERNETES_SERVER_URL")),
		namespace:           strings.TrimSpace(os.Getenv("KEDA_HPA_POSTURE_NAMESPACE")),
		sharedSecret:        strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET")),
		timeout:             5 * time.Second,
		token:               strings.TrimSpace(os.Getenv("KEDA_HPA_POSTURE_KUBERNETES_BEARER_TOKEN")),
		tokenFile:           strings.TrimSpace(os.Getenv("KEDA_HPA_POSTURE_TOKEN_FILE")),
		workflowTaskQueue:   strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE")),
	}
	if opts.namespace == "" {
		opts.namespace = strings.TrimSpace(os.Getenv("POD_NAMESPACE"))
	}
	if opts.tokenFile == "" {
		opts.tokenFile = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	}
	if opts.kubernetesCAFile == "" {
		opts.kubernetesCAFile = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	}
	if opts.workflowTaskQueue == "" {
		opts.workflowTaskQueue = temporalruntime.WorkflowTaskQueue
	}
	if opts.kubernetesServerURL == "" {
		opts.kubernetesServerURL = inClusterServerURL()
	}
	flags := flag.NewFlagSet("keda-hpa-posture-collector", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	timeoutMS := int(opts.timeout / time.Millisecond)
	flags.BoolVar(&opts.allowInsecureTLS, "kubernetes-insecure-skip-tls-verify", false, "skip Kubernetes API TLS verification")
	flags.StringVar(&opts.appAPIBaseURL, "app-api-base-url", opts.appAPIBaseURL, "app-api base URL")
	flags.StringVar(&opts.kubernetesCAFile, "kubernetes-ca-file", opts.kubernetesCAFile, "Kubernetes API CA bundle file")
	flags.StringVar(&opts.kubernetesServerURL, "kubernetes-server-url", opts.kubernetesServerURL, "Kubernetes API server URL")
	flags.StringVar(&opts.namespace, "namespace", opts.namespace, "Kubernetes namespace")
	flags.StringVar(&opts.sharedSecret, "shared-secret", opts.sharedSecret, "app-api internal shared secret")
	flags.IntVar(&timeoutMS, "timeout-ms", timeoutMS, "request timeout in milliseconds")
	flags.StringVar(&opts.token, "token", opts.token, "Kubernetes bearer token")
	flags.StringVar(&opts.tokenFile, "token-file", opts.tokenFile, "Kubernetes service account token file")
	flags.StringVar(&opts.workflowTaskQueue, "workflow-task-queue", opts.workflowTaskQueue, "Temporal workflow task queue")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	opts.timeout = time.Duration(timeoutMS) * time.Millisecond
	if opts.timeout <= 0 {
		return options{}, errors.New("timeout-ms must be positive")
	}
	if strings.TrimSpace(opts.token) == "" {
		token, err := os.ReadFile(opts.tokenFile)
		if err != nil {
			return options{}, err
		}
		opts.token = strings.TrimSpace(string(token))
	}
	missing := []string{}
	if strings.TrimSpace(opts.appAPIBaseURL) == "" {
		missing = append(missing, "app-api-base-url")
	}
	if strings.TrimSpace(opts.sharedSecret) == "" {
		missing = append(missing, "shared-secret")
	}
	if strings.TrimSpace(opts.kubernetesServerURL) == "" {
		missing = append(missing, "kubernetes-server-url")
	}
	if strings.TrimSpace(opts.namespace) == "" {
		missing = append(missing, "namespace")
	}
	if strings.TrimSpace(opts.token) == "" {
		missing = append(missing, "token")
	}
	if strings.TrimSpace(opts.workflowTaskQueue) == "" {
		missing = append(missing, "workflow-task-queue")
	}
	if len(missing) > 0 {
		return options{}, fmt.Errorf("%s required", strings.Join(missing, ", "))
	}
	opts.targets = defaultTargets(opts.workflowTaskQueue)
	return opts, nil
}

func buildRuntimeClients(opts options) (*http.Client, *http.Client) {
	timeout := opts.timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	kubernetesTransport := http.DefaultTransport.(*http.Transport).Clone()
	if opts.allowInsecureTLS {
		kubernetesTransport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	} else if opts.kubernetesRootCAs != nil {
		kubernetesTransport.TLSClientConfig = &tls.Config{RootCAs: opts.kubernetesRootCAs}
	}
	appAPITransport := http.DefaultTransport.(*http.Transport).Clone()
	return &http.Client{Timeout: timeout, Transport: kubernetesTransport},
		&http.Client{Timeout: timeout, Transport: appAPITransport}
}

func caCertPool(path string) (*x509.CertPool, error) {
	caPEM, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("kubernetes CA bundle %s contains no PEM certificates", path)
	}
	return pool, nil
}

func inClusterServerURL() string {
	host := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_HOST"))
	port := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_PORT"))
	if host == "" || port == "" {
		return ""
	}
	return "https://" + host + ":" + port
}

func defaultTargets(workflowTaskQueue string) []kedaposture.Target {
	workflowQueue := strings.TrimSpace(workflowTaskQueue)
	if workflowQueue == "" {
		workflowQueue = temporalruntime.WorkflowTaskQueue
	}
	return []kedaposture.Target{
		workerTarget("workflow-worker", workflowQueue, autoscaler.TaskQueueKindWorkflow, 3),
		workerTarget("activity-worker-core", temporalruntime.ActivityTaskQueueCore, autoscaler.TaskQueueKindActivity, 3),
		workerTarget("activity-worker-agent", temporalruntime.ActivityTaskQueueAgent, autoscaler.TaskQueueKindActivity, 3),
	}
}

func workerTarget(name string, taskQueue string, queueKind string, maxReplicas int) kedaposture.Target {
	return kedaposture.Target{
		MaxReplicas:   maxReplicas,
		MinReplicas:   1,
		Name:          name,
		QueueKind:     queueKind,
		ScaledObject:  name,
		TaskQueue:     taskQueue,
		TargetService: name,
	}
}
