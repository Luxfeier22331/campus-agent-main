package main

import (
	"crypto/x509"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestParseOptionsRequiresKubernetesAndAppAPIInputs(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	_, err := parseOptions([]string{})
	if err == nil {
		t.Fatal("parseOptions returned nil error")
	}
}

func TestParseOptionsBuildsInClusterServerURLAndDefaultTargets(t *testing.T) {
	tokenFile := t.TempDir() + "/token"
	if err := os.WriteFile(tokenFile, []byte("test-token\n"), 0o600); err != nil {
		t.Fatalf("write token: %v", err)
	}
	caFile := t.TempDir() + "/ca.crt"
	if err := os.WriteFile(caFile, []byte("ca"), 0o600); err != nil {
		t.Fatalf("write CA: %v", err)
	}
	t.Setenv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
	t.Setenv("KUBERNETES_SERVICE_PORT", "443")
	t.Setenv("EXECUTION_CONTROL_APP_API_BASE_URL", "https://app-api.internal")
	t.Setenv("EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET", "shared-secret")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE", "campus-agent.workflow")

	options, err := parseOptions([]string{
		"--kubernetes-ca-file", caFile,
		"--namespace", "campus-agent-staging",
		"--token-file", tokenFile,
	})
	if err != nil {
		t.Fatalf("parseOptions returned error: %v", err)
	}
	if options.kubernetesServerURL != "https://kubernetes.default.svc:443" {
		t.Fatalf("server URL = %q", options.kubernetesServerURL)
	}
	if options.token != "test-token" {
		t.Fatalf("token = %q", options.token)
	}
	if options.kubernetesCAFile != caFile {
		t.Fatalf("kubernetesCAFile = %q", options.kubernetesCAFile)
	}
	if len(options.targets) != 4 {
		t.Fatalf("target count = %d", len(options.targets))
	}
	if options.targets[0].Name != "workflow-worker" ||
		options.targets[0].QueueKind != "workflow" ||
		options.targets[0].TaskQueue != "campus-agent.workflow" {
		t.Fatalf("workflow target = %#v", options.targets[0])
	}
	if options.targets[3].Name != "activity-worker-knowledge" ||
		options.targets[3].MaxReplicas != 5 {
		t.Fatalf("knowledge target = %#v", options.targets[3])
	}
}

func TestBuildRuntimeClientsKeepKubernetesCAOutOfAppAPIClient(t *testing.T) {
	kubernetesPool := tlsRootPoolForTest(t)
	kubernetesClient, appAPIClient := buildRuntimeClients(options{
		kubernetesRootCAs: kubernetesPool,
		timeout:           5 * time.Second,
	})
	kubernetesTransport, ok := kubernetesClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("kubernetes transport type = %T", kubernetesClient.Transport)
	}
	if kubernetesTransport.TLSClientConfig == nil ||
		kubernetesTransport.TLSClientConfig.RootCAs != kubernetesPool {
		t.Fatalf("kubernetes client did not use provided root CAs")
	}
	appAPITransport, ok := appAPIClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("app-api transport type = %T", appAPIClient.Transport)
	}
	if appAPITransport.TLSClientConfig != nil && appAPITransport.TLSClientConfig.RootCAs == kubernetesPool {
		t.Fatalf("app-api client must not inherit Kubernetes root CAs")
	}
}

func tlsRootPoolForTest(t *testing.T) *x509.CertPool {
	t.Helper()
	pool := x509.NewCertPool()
	if pool == nil {
		t.Fatal("x509.NewCertPool returned nil")
	}
	return pool
}
