package memoryruntimeapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/hindsightadapter"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
)

type Config struct {
	Host              string
	Port              int
	DatabaseURL       string
	HindsightURL      string
	HindsightSecret   string
	OwnerSalt         string
	TemporalAddress   string
	TemporalNamespace string
	CallbackURL       string
	CallbackSecret    string
	SharedSecret      string
	Timeout           time.Duration
}

func LoadConfig(env map[string]string) (Config, error) {
	get := func(k string) string {
		if v, ok := env[k]; ok {
			return strings.TrimSpace(v)
		}
		return strings.TrimSpace(os.Getenv(k))
	}
	port := 8000
	if v := get("MEMORY_PORT"); v != "" {
		n, e := strconv.Atoi(v)
		if e != nil {
			return Config{}, fmt.Errorf("MEMORY_PORT: %w", e)
		}
		port = n
	}
	timeout := 90 * time.Second
	if v := get("MEMORY_TIMEOUT_SECONDS"); v != "" {
		n, e := strconv.ParseFloat(v, 64)
		if e != nil {
			return Config{}, fmt.Errorf("MEMORY_TIMEOUT_SECONDS: %w", e)
		}
		timeout = time.Duration(n * float64(time.Second))
	}
	c := Config{Host: get("MEMORY_HOST"), Port: port, DatabaseURL: get("MEMORY_DATABASE_URL"), HindsightURL: get("HINDSIGHT_API_BASE_URL"), HindsightSecret: get("HINDSIGHT_API_TENANT_API_KEY"), OwnerSalt: get("HINDSIGHT_OWNER_SALT"), TemporalAddress: get("MEMORY_TEMPORAL_ADDRESS"), TemporalNamespace: get("MEMORY_TEMPORAL_NAMESPACE"), CallbackURL: get("APP_PRODUCT_CALLBACK_BASE_URL"), CallbackSecret: get("APP_PRODUCT_CALLBACK_SHARED_SECRET"), SharedSecret: get("MEMORY_INTERNAL_SHARED_SECRET"), Timeout: timeout}
	if c.Host == "" {
		c.Host = "0.0.0.0"
	}
	if c.TemporalNamespace == "" {
		c.TemporalNamespace = "default"
	}

	if c.HindsightURL != "" {
		if u, e := url.Parse(c.HindsightURL); e != nil || u.Scheme == "" || u.Host == "" {
			return Config{}, fmt.Errorf("invalid HINDSIGHT_API_BASE_URL")
		}
	}
	for key, value := range map[string]string{"MEMORY_DATABASE_URL": c.DatabaseURL, "HINDSIGHT_API_BASE_URL": c.HindsightURL, "HINDSIGHT_OWNER_SALT": c.OwnerSalt, "MEMORY_INTERNAL_SHARED_SECRET": c.SharedSecret} {
		if value == "" {
			return Config{}, fmt.Errorf("%s is required", key)
		}
	}
	if port < 1 || port > 65535 || timeout <= 0 {
		return Config{}, fmt.Errorf("invalid memory port or timeout")
	}
	return c, nil
}

type Resources struct {
	Store       *memorypersistence.PostgresStateStore
	StoreErr    error
	Admission   *memoryapplication.Admission
	Management  *memoryapplication.MemoryManagementService
	Recaller    memoryapplication.MemoryRecaller
	Commands    memoryapplication.MemoryCommandExecutor
	Async       memoryapplication.AsyncMemoryExecutor
	Profile     memoryapplication.ProfileReader
	ProviderErr error
}

func NewResources(ctx context.Context, c Config) Resources {
	store, err := memorypersistence.NewPostgresStateStore(ctx, memorypersistence.PostgresStateStoreOptions{DatabaseURL: c.DatabaseURL, Schema: "memory"})
	provider, providerErr := hindsightadapter.New(hindsightadapter.Options{BaseURL: c.HindsightURL, APISecret: c.HindsightSecret, OwnerSalt: c.OwnerSalt, Timeout: c.Timeout})
	var rec memoryapplication.MemoryRecaller
	var cmd memoryapplication.MemoryCommandExecutor
	var async memoryapplication.AsyncMemoryExecutor
	var profile memoryapplication.ProfileReader
	if providerErr == nil && err == nil {
		rec = memoryapplication.NewFencedMemoryRecaller(provider, store, c.OwnerSalt, c.Timeout)
		cmd = provider
		async = provider
		profile = &memoryapplication.ProfileService{Provider: provider, State: store, OwnerSalt: c.OwnerSalt, Timeout: c.Timeout}
	}
	admission := &memoryapplication.Admission{Store: store, OwnerSalt: c.OwnerSalt}
	return Resources{Admission: admission, Store: store, StoreErr: err, Management: memoryapplication.NewMemoryManagementService(memoryapplication.MemoryManagementOptions{Store: store, StoreError: err, Starter: admission, OwnerSalt: c.OwnerSalt}), Recaller: rec, Commands: cmd, Async: async, Profile: profile, ProviderErr: providerErr}
}
