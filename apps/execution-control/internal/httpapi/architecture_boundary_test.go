package httpapi

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestServerDoesNotImplementTemporalActivitySets(t *testing.T) {
	server := any(&Server{})
	for name, implemented := range map[string]bool{
		"agent":        implements[temporalruntime.AgentActivities](server),
		"context":      implements[temporalruntime.ContextActivities](server),
		"finalization": implements[temporalruntime.FinalizationActivities](server),
	} {
		if implemented {
			t.Fatalf("httpapi.Server implements the %s Temporal activity set", name)
		}
	}
}

func TestServerInfrastructureFieldsUseTheirOwnedPackages(t *testing.T) {
	serverType := reflect.TypeOf(Server{})
	tests := []struct {
		field   string
		owner   string
		pointer bool
	}{
		{
			field: "executionInputLoader",
			owner: "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution",
		},
		{
			field:   "executionReconciler",
			owner:   "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler",
			pointer: true,
		},
		{
			field: "primaryAgentTargetResolver",
			owner: "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient",
		},
	}

	for _, test := range tests {
		field, ok := serverType.FieldByName(test.field)
		if !ok {
			t.Fatalf("Server field %s is missing", test.field)
		}
		fieldType := field.Type
		if test.pointer {
			fieldType = fieldType.Elem()
		}
		if fieldType.PkgPath() != test.owner {
			t.Fatalf("Server.%s owner = %q, want %q", test.field, fieldType.PkgPath(), test.owner)
		}
	}
}

func TestRetiredInfrastructureImplementationsDoNotReturnToHTTPPackage(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	directory := filepath.Dir(filename)
	for _, name := range []string{
		"document_evidence_qdrant.go",
		"execution_input_loader.go",
		"execution_input_projection.go",
		"provider_config_resolver.go",
		"provider_config_resolution.go",
		"temporal_reconcile_cancellations.go",
		"temporal_reconcile_identity.go",
		"temporal_reconcile_starts.go",
		"temporal_reconcile_timeouts.go",
		"temporal_reconciler.go",
	} {
		_, err := os.Stat(filepath.Join(directory, name))
		if err == nil {
			t.Fatalf("retired httpapi implementation returned: %s", name)
		}
		if !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("inspect %s: %v", name, err)
		}
	}
}

func implements[T any](value any) bool {
	_, ok := value.(T)
	return ok
}
