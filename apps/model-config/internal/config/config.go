package config

import (
	"fmt"
	"strings"

	env "github.com/caarlos0/env/v11"
)

type Config struct {
	Host              string
	Port              int
	DatabaseURL       string
	EncryptionKeyPath string
}

type envValues struct {
	Host              string `env:"MODEL_CONFIG_HOST" envDefault:"0.0.0.0"`
	Port              int    `env:"MODEL_CONFIG_PORT" envDefault:"8000"`
	DatabaseURL       string `env:"MODEL_CONFIG_DATABASE_URL"`
	EncryptionKeyPath string `env:"MODEL_CONFIG_ENCRYPTION_KEY_FILE"`
}

func Load() (Config, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return Config{}, fmt.Errorf("parse model-config environment: %w", err)
	}
	cfg := Config{
		Host:              strings.TrimSpace(values.Host),
		Port:              values.Port,
		DatabaseURL:       strings.TrimSpace(values.DatabaseURL),
		EncryptionKeyPath: strings.TrimSpace(values.EncryptionKeyPath),
	}
	if cfg.Host == "" || cfg.Port < 1 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("model-config listen configuration is invalid")
	}
	if cfg.DatabaseURL == "" || cfg.EncryptionKeyPath == "" {
		return Config{}, fmt.Errorf("MODEL_CONFIG_DATABASE_URL and MODEL_CONFIG_ENCRYPTION_KEY_FILE are required")
	}
	return cfg, nil
}
