package config

import (
	"strings"
	"testing"
)

func TestLoadTrimsValuesAndUsesSinglePort(t *testing.T) {
	setValidEnvironment(t)
	t.Setenv("MODEL_CONFIG_HOST", " 127.0.0.1 ")
	t.Setenv("MODEL_CONFIG_DATABASE_URL", " postgres://model-config/test ")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 8000 || cfg.DatabaseURL != "postgres://model-config/test" {
		t.Fatalf("Config = %#v", cfg)
	}
}

func TestLoadRejectsInvalidPort(t *testing.T) {
	setValidEnvironment(t)
	t.Setenv("MODEL_CONFIG_PORT", "65536")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "listen configuration") {
		t.Fatalf("Load() error = %v", err)
	}
}

func TestLoadRequiresStoreConfiguration(t *testing.T) {
	setValidEnvironment(t)
	t.Setenv("MODEL_CONFIG_ENCRYPTION_KEY_FILE", " ")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "MODEL_CONFIG_DATABASE_URL") {
		t.Fatalf("Load() error = %v", err)
	}
}

func setValidEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("MODEL_CONFIG_HOST", "127.0.0.1")
	t.Setenv("MODEL_CONFIG_PORT", "8000")
	t.Setenv("MODEL_CONFIG_DATABASE_URL", "postgres://model-config/test")
	t.Setenv("MODEL_CONFIG_ENCRYPTION_KEY_FILE", "/run/secrets/model-config-key")
}
