package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/httpapi"
	modelconfig "github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/modelconfig"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/outbound"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/persistence"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("campus_search_service.stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	modelConfigURL := strings.TrimRight(strings.TrimSpace(firstEnv("CAMPUS_SEARCH_MODEL_CONFIG_URL", "MODEL_CONFIG_URL")), "/")
	resolver, err := modelconfig.New(modelConfigURL)
	if err != nil {
		return err
	}
	cfg := outbound.Config{DeploymentEnvironment: envOr("DEPLOYMENT_ENVIRONMENT", "local"), QdrantURL: firstEnv("CAMPUS_SEARCH_QDRANT_URL", "QDRANT_URL"), QdrantReadOnlyAPIKey: firstEnv("CAMPUS_SEARCH_QDRANT_READ_ONLY_API_KEY", "QDRANT_READ_ONLY_API_KEY"), QdrantTLSCACertPath: firstEnv("CAMPUS_SEARCH_QDRANT_TLS_CA_CERT_PATH", "QDRANT_TLS_CA_CERT_PATH")}
	indexStore, err := persistence.NewPostgresIndexStore(os.Getenv("CAMPUS_SEARCH_DATABASE_URL"))
	if err != nil {
		return err
	}
	defer indexStore.Close()
	searcher, err := outbound.NewCampusDocsSearcher(cfg, resolver, logger)
	if err != nil {
		return err
	}
	serviceInstance := service.New(indexStore, searcher)
	server := &http.Server{Addr: fmt.Sprintf("%s:%d", envOr("HOST", "0.0.0.0"), envInt("PORT", 8000)), Handler: httpapi.NewWithLogger(serviceInstance, os.Getenv("RETRIEVAL_INTERNAL_TOKEN"), parseMCPClientTokens(os.Getenv("CAMPUS_MCP_CLIENT_TOKENS")), logger).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 70 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	serverErr := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()
	select {
	case <-ctx.Done():
	case err := <-serverErr:
		return err
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}

func parseMCPClientTokens(value string) map[string]string {
	result := map[string]string{}
	for _, item := range strings.Split(value, ",") {
		caller, token, ok := strings.Cut(strings.TrimSpace(item), "=")
		if ok && strings.TrimSpace(caller) != "" && strings.TrimSpace(token) != "" {
			result[strings.TrimSpace(caller)] = strings.TrimSpace(token)
		}
	}
	return result
}
func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}
func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
