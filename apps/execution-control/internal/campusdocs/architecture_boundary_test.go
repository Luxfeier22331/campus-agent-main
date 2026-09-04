package campusdocs

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

func TestCampusDocsDomainDoesNotImportPostgresDriver(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve campusdocs package path")
	}
	directory := filepath.Dir(filename)
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read campusdocs directory: %v", err)
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
			if strings.HasPrefix(importPath, "github.com/jackc/pgx") {
				t.Fatalf("campusdocs domain imports PostgreSQL driver in %s", path)
			}
		}
	}
}
