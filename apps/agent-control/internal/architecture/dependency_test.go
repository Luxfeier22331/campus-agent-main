package architecture_test

import (
	"bytes"
	"encoding/json"
	"io"
	"os/exec"
	"strings"
	"testing"
)

const module = "github.com/MUC-WIKI/campus-agent/apps/agent-control/"
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
	infrastructure := []string{"go.temporal.io", "github.com/jackc/pgx", internal + "httpapi", internal + "executionpersistence", internal + "memorypersistence", internal + "outboundadapter", internal + "hindsightadapter", internal + "temporalclient", internal + "runtimeprojection", internal + "runtimeassembly", internal + "toolcontract"}
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
		if within(info.ImportPath, internal+"executionapplication") || info.ImportPath == internal+"executionfailure" {
			check(info.Deps, append(infrastructure, internal+"config", internal+"agentruntimeprotocol"))
		}
		switch info.ImportPath {
		case internal + "agentruntimeprotocol", internal + "executionreadmodel":
			check(info.Deps, infrastructure)
			check(info.Deps, []string{internal + "executionapplication", internal + "config"})
		case internal + "execution", internal + "executioncontract", internal + "memoryruntime", internal + "campusdocs", internal + "contracts", internal + "executionapplication":
			check(info.Deps, infrastructure)
		case internal + "memoryapplication":
			check(info.Deps, infrastructure)
			check(info.Deps, []string{internal + "execution", internal + "executionapplication", internal + "config"})
		case internal + "httpapi", internal + "executionreconciler":
			check(info.Deps, []string{"go.temporal.io", internal + "temporalclient", internal + "runtimeprojection"})
		case internal + "temporalclient", internal + "temporalclient/control":
			check(info.Deps, []string{internal + "runtimeprojection", internal + "runtimeapi"})
		case internal + "config":
			check(info.Deps, []string{internal + "temporalclient", internal + "runtimeprojection"})
		}
		check(info.Imports, []string{module + "integration", "github.com/testcontainers/testcontainers-go"})
		if info.ImportPath != internal+"runtimeassembly" {
			check(info.Imports, []string{"go.temporal.io/sdk/worker"})
		}
		if within(info.ImportPath, internal+"runtimeprojection") {
			check(info.Imports, []string{internal + "executionpersistence", internal + "memorypersistence", internal + "outboundadapter"})
			for _, dependency := range info.Imports {
				if dependency == internal+"runtimeprojection" {
					t.Errorf("activity owner depends on aggregate adapter: %s", info.ImportPath)
				}
			}
		}
		// In-process SDK unit tests remain local; external-service fixtures belong to integration.
		tests := append(append([]string{}, info.TestImports...), info.XTestImports...)
		check(tests, []string{module + "integration/temporaltest", "github.com/testcontainers/testcontainers-go"})
	}
}
