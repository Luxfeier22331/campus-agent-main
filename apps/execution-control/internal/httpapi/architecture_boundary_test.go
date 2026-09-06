package httpapi

import (
	"errors"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestServerDoesNotImplementTemporalActivitySets(t *testing.T) {
	server := any(&Server{})
	for name, implemented := range map[string]bool{
		"workflow":     implements[temporalruntime.WorkflowActivities](server),
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
			field:   "runService",
			owner:   "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication",
			pointer: true,
		},
		{
			field:   "agentToolService",
			owner:   "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication",
			pointer: true,
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
		"campus_docs_qdrant.go",
		"campus_docs_rerank.go",
		"campus_docs_retrieval.go",
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

func TestExecutionHandlersDoNotImportTheirFormerRuleOwners(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	directory := filepath.Dir(filename)
	tests := map[string][]string{
		"campus_search_tool.go": {
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime",
		},
		"execution_run_handlers.go": {
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime",
		},
		"personal_memory_recall_tool.go": {
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter",
			"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime",
		},
	}
	for name, forbidden := range tests {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(directory, name)
			file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				t.Fatalf("parse %s: %v", path, err)
			}
			for _, imported := range file.Imports {
				importPath, err := strconv.Unquote(imported.Path.Value)
				if err != nil {
					t.Fatalf("decode import in %s: %v", path, err)
				}
				for _, blocked := range forbidden {
					if importPath == blocked || strings.HasPrefix(importPath, blocked+"/") {
						t.Fatalf("%s imports former rule owner %q", name, importPath)
					}
				}
			}
		})
	}
}

func implements[T any](value any) bool {
	_, ok := value.(T)
	return ok
}
