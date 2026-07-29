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

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/cmd/internal/workermain"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
)

const providerConfigAdminPort = 8001

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("campus execution runtime stopped", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.LoadRuntimeFromEnv()
	if err != nil {
		return fmt.Errorf("load runtime config: %w", err)
	}

	runtimeContext, stopSignals := signal.NotifyContext(
		context.Background(),
		syscall.SIGINT,
		syscall.SIGTERM,
	)
	defer stopSignals()

	handler := httpapi.NewServerWithDependencies(cfg, nil, logger, nil)
	adminHandler, err := httpapi.NewProviderConfigAdminServer(cfg)
	if err != nil {
		_ = handler.Shutdown(context.Background())
		return fmt.Errorf("initialize provider config admin: %w", err)
	}
	defer adminHandler.Close()

	runtimeWorkers, err := workermain.StartRuntimeWorkers(runtimeContext, cfg, handler, logger)
	if err != nil {
		_ = handler.Shutdown(context.Background())
		return err
	}
	defer runtimeWorkers.Stop()

	handler.StartTemporalReconciler(runtimeContext)
	gatewayServer := newHTTPServer(
		fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		handler,
		time.Duration(cfg.RequestTimeoutMS+2_000)*time.Millisecond,
	)
	adminServer := newHTTPServer(
		fmt.Sprintf("%s:%d", cfg.Host, providerConfigAdminPort),
		adminHandler,
		15*time.Second,
	)
	serverErrors := make(chan error, 2)
	startHTTPServer("execution-control", gatewayServer, serverErrors, logger)
	startHTTPServer("provider-config-admin", adminServer, serverErrors, logger)

	var runtimeErr error
	select {
	case <-runtimeContext.Done():
		logger.Info("campus execution runtime draining")
	case runtimeErr = <-runtimeWorkers.Errors():
	case runtimeErr = <-serverErrors:
	}

	handler.StartDraining()
	handler.StopTemporalReconciler()
	runtimeWorkers.Stop()

	shutdownContext, cancel := context.WithTimeout(
		context.Background(),
		time.Duration(cfg.ShutdownGraceMS)*time.Millisecond,
	)
	defer cancel()
	if err := gatewayServer.Shutdown(shutdownContext); err != nil && runtimeErr == nil {
		runtimeErr = fmt.Errorf("shutdown execution-control HTTP server: %w", err)
	}
	if err := adminServer.Shutdown(shutdownContext); err != nil && runtimeErr == nil {
		runtimeErr = fmt.Errorf("shutdown provider-config admin HTTP server: %w", err)
	}
	if err := handler.Shutdown(shutdownContext); err != nil && runtimeErr == nil {
		runtimeErr = fmt.Errorf("shutdown execution runtime: %w", err)
	}
	return runtimeErr
}

func newHTTPServer(address string, handler http.Handler, writeTimeout time.Duration) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       60 * time.Second,
	}
}

func startHTTPServer(
	name string,
	server *http.Server,
	serverErrors chan<- error,
	logger *slog.Logger,
) {
	logger.Info("campus execution runtime listening", "component", name, "address", server.Addr)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrors <- fmt.Errorf("%s HTTP server: %w", name, err)
		}
	}()
}
