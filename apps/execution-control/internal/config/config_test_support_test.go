package config

import (
	"os"
	"path/filepath"
	"testing"
)

func readDefaultRuntimeConfigFile() ([]byte, error) {
	return os.ReadFile(filepath.Join("testdata", "default-runtime-config.json"))
}

func readDefaultRuntimeConfigForTest(t testing.TB) []byte {
	t.Helper()
	profile, err := readDefaultRuntimeConfigFile()
	if err != nil {
		t.Fatalf("read default runtime config fixture: %v", err)
	}
	return profile
}
