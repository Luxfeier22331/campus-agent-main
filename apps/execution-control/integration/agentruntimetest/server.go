// Package agentruntimetest starts the production Node HTTP/runtime boundary with
// a controlled provider runner. It never calls a paid provider.
package agentruntimetest

import (
	"bufio"
	"bytes"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func Start(t *testing.T) string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "../.."))
	cmd := exec.CommandContext(t.Context(), "node", "--experimental-strip-types", filepath.Join(filepath.Dir(file), "server.ts"))
	cmd.Dir = root
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		if t.Failed() {
			t.Log(stderr.String())
		}
	})
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		if scanner.Scan() {
			ready <- scanner.Text()
		} else {
			ready <- ""
		}
	}()
	select {
	case address := <-ready:
		if !strings.HasPrefix(address, "http://127.0.0.1:") {
			t.Fatalf("Node runtime startup: %q", address)
		}
		return address
	case <-time.After(20 * time.Second):
		t.Fatal("Node runtime startup timed out")
	}
	return ""
}
