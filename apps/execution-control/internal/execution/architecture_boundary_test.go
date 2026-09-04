package execution

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestExecutionCorePackagesDoNotImportTransportOrInfrastructureSDKs(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve architecture test path")
	}
	internalDirectory := filepath.Dir(filepath.Dir(filename))
	for _, packageName := range []string{
		"execution",
		"executionapplication",
		"executionreconciler",
	} {
		t.Run(packageName, func(t *testing.T) {
			assertPackageExcludesImports(t, filepath.Join(internalDirectory, packageName), []string{
				"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi",
				"github.com/jackc/pgx",
				"go.temporal.io/",
				"net/http",
			})
		})
	}
}

func assertPackageExcludesImports(t *testing.T, directory string, forbidden []string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read package directory %s: %v", directory, err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") ||
			strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		for _, imported := range file.Imports {
			importPath, err := strconv.Unquote(imported.Path.Value)
			if err != nil {
				t.Fatalf("decode import in %s: %v", path, err)
			}
			for _, prefix := range forbidden {
				if importPath == prefix || strings.HasPrefix(importPath, prefix) {
					t.Fatalf("%s imports forbidden dependency %q", path, importPath)
				}
			}
		}
	}
}
