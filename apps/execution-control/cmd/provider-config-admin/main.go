package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.LoadProviderConfigAdminFromEnv()
	if err != nil {
		logger.Error("provider config admin configuration invalid", "error", err.Error())
		os.Exit(1)
	}
	handler, err := httpapi.NewProviderConfigAdminServer(cfg)
	if err != nil {
		logger.Error("provider config admin initialization failed", "error", err.Error())
		os.Exit(1)
	}
	defer handler.Close()

	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.ListenAndServe() }()

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case signalValue := <-shutdownSignals:
		logger.Info("provider config admin shutting down", "signal", signalValue.String())
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("provider config admin shutdown failed", "error", err.Error())
			os.Exit(1)
		}
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("provider config admin failed", "error", err.Error())
			os.Exit(1)
		}
		return
	}

	if err := <-serverErrors; err != nil && err != http.ErrServerClosed {
		logger.Error("provider config admin failed", "error", err.Error())
		os.Exit(1)
	}
}
