package main

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
)

func TestNewRunProjectionStoreIsNilWhenDatabaseURLIsNotConfigured(t *testing.T) {
	store, err := newRunProjectionStore(context.Background(), config.Config{})
	if err != nil {
		t.Fatalf("new run projection store without database url: %v", err)
	}
	if store != nil {
		t.Fatalf("run projection store = %#v, want nil when database url is not configured", store)
	}
}

func TestNewRunProjectionStoreDefersConnectionErrorToHealthCheck(t *testing.T) {
	store, err := newRunProjectionStore(context.Background(), config.Config{
		DatabaseURL: "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
	})
	if err != nil {
		t.Fatalf("new run projection store: %v", err)
	}
	postgresStore, ok := store.(*executionpersistence.PostgresRunProjectionStore)
	if !ok {
		t.Fatalf("run projection store = %T, want *executionpersistence.PostgresRunProjectionStore", store)
	}
	defer postgresStore.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := postgresStore.HealthCheck(ctx); err == nil {
		t.Fatal("HealthCheck returned nil error for unavailable Postgres")
	}
}

func TestNewRunProjectionStoreRejectsMalformedDatabaseURL(t *testing.T) {
	store, err := newRunProjectionStore(context.Background(), config.Config{
		DatabaseURL: "://malformed",
	})
	if store != nil || err == nil {
		t.Fatalf("new run projection store = (%#v, %v), want malformed URL error", store, err)
	}
}
