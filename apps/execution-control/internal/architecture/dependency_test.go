package architecture_test

import (
	"bytes"
	"encoding/json"
	"io"
	"os/exec"
	"strings"
	"testing"
)

const module = "github.com/MUC-WIKI/campus-agent/apps/execution-control/"
const internal = module + "internal/"

type packageInfo struct {
	ImportPath   string
	Imports      []string
	Deps         []string
	TestImports  []string
	XTestImports []string
}

func within(path, owner string) bool { return path == owner || strings.HasPrefix(path, owner+"/") }

func TestInternalDependencyBoundaries(t *testing.T) {
	command := exec.CommandContext(t.Context(), "go", "list", "-json", "./internal/...", "./cmd/...")
	command.Dir = "../.."
	output, err := command.Output()
	if err != nil {
		t.Fatalf("list package graph: %v", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	infrastructure := []string{"go.temporal.io", "github.com/jackc/pgx", internal + "httpapi", internal + "executionpersistence", internal + "memorypersistence", internal + "outboundadapter", internal + "hindsightadapter", internal + "temporalruntime", internal + "temporaladapter", internal + "runtimeassembly", internal + "toolcontract"}
	for {
		var info packageInfo
		if err := decoder.Decode(&info); err != nil {
			if err == io.EOF {
				break
			}
			t.Fatal(err)
		}
		check := func(dependencies, blocked []string) {
			for _, dependency := range dependencies {
				for _, owner := range blocked {
					if within(dependency, owner) {
						t.Errorf("forbidden package edge: %s -> %s", info.ImportPath, dependency)
					}
				}
			}
		}
		switch info.ImportPath {
		case internal + "execution", internal + "memoryruntime", internal + "campusdocs", internal + "contracts", internal + "executionapplication":
			check(info.Deps, infrastructure)
		case internal + "httpapi", internal + "executionreconciler":
			check(info.Deps, []string{"go.temporal.io", internal + "temporalruntime", internal + "temporaladapter"})
		case internal + "config":
			check(info.Deps, []string{internal + "temporalruntime", internal + "temporaladapter"})
		}
		check(info.Imports, []string{module + "integration", "github.com/testcontainers/testcontainers-go"})
		if info.ImportPath != internal+"runtimeassembly" {
			check(info.Imports, []string{"go.temporal.io/sdk/worker"})
		}
		if within(info.ImportPath, internal+"temporaladapter") {
			check(info.Imports, []string{internal + "executionpersistence", internal + "memorypersistence", internal + "outboundadapter"})
			for _, dependency := range info.Imports {
				if dependency == internal+"temporaladapter" {
					t.Errorf("activity owner depends on aggregate adapter: %s", info.ImportPath)
				}
			}
		}
		// In-process SDK unit tests remain local; external-service fixtures belong to integration.
		tests := append(append([]string{}, info.TestImports...), info.XTestImports...)
		check(tests, []string{module + "integration/temporaltest", "github.com/testcontainers/testcontainers-go"})
	}
}
