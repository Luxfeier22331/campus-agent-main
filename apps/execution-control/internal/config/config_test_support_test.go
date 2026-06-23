package config

import (
	"os"
	"path/filepath"
	"testing"
)

func readDefaultRuntimeConfigProfileFile() ([]byte, error) {
	return os.ReadFile(filepath.Join("testdata", "default-runtime-profile.json"))
}

func readDefaultRuntimeConfigProfileForTest(t testing.TB) []byte {
	t.Helper()
	profile, err := readDefaultRuntimeConfigProfileFile()
	if err != nil {
		t.Fatalf("read default runtime profile fixture: %v", err)
	}
	return profile
}
