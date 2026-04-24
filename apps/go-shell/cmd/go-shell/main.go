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

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("campus go-shell config invalid", "error", err.Error())
		os.Exit(1)
	}
	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	bridgeClient := bridge.NewHTTPClient(cfg.BridgeBaseURL, cfg.BridgeSharedSecret)
	handler := httpapi.NewServerWithDependencies(cfg, bridgeClient, nil, logger, nil)

	server := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      time.Duration(cfg.RequestTimeoutMS+2_000) * time.Millisecond,
		IdleTimeout:       60 * time.Second,
	}

	logger.Info("campus go-shell listening", "address", address)
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case signalValue := <-shutdownSignals:
		logger.Info("campus go-shell draining", "signal", signalValue.String())
		handler.StartDraining()
		ctx, cancel := context.WithTimeout(
			context.Background(),
			time.Duration(cfg.ShutdownGraceMS)*time.Millisecond,
		)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("campus go-shell graceful shutdown failed", "error", err.Error())
			os.Exit(1)
		}
		if err := handler.Shutdown(ctx); err != nil {
			logger.Error("campus go-shell telemetry shutdown failed", "error", err.Error())
		}
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("campus go-shell failed", "error", err.Error())
			os.Exit(1)
		}
		return
	}

	if err := <-serverErrors; err != nil && err != http.ErrServerClosed {
		logger.Error("campus go-shell failed", "error", err.Error())
		os.Exit(1)
	}
}
