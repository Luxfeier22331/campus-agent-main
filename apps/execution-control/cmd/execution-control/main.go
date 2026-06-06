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

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("campus execution-control config invalid", "error", err.Error())
		os.Exit(1)
	}
	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	bridgeClient := bridge.NewHTTPClientWithResponseLimit(
		cfg.BridgeBaseURL,
		cfg.BridgeSharedSecret,
		cfg.BridgeResponseLimitBytes,
	)
	handler := httpapi.NewServerWithDependencies(cfg, bridgeClient, nil, logger, nil)
	runtimeCtx, runtimeCancel := context.WithCancel(context.Background())
	defer runtimeCancel()
	temporalWorkers, err := temporalruntime.NewWorkerRuntime(runtimeCtx, temporalruntime.WorkerOptions{
		Address:                cfg.TemporalAddress,
		Namespace:              cfg.TemporalNamespace,
		WorkflowQueue:          cfg.TemporalTaskQueue,
		RAGQueue:               temporalruntime.ActivityTaskQueueRAG,
		FinalizationQueue:      temporalruntime.ActivityTaskQueueFinalization,
		WorkerID:               cfg.TemporalWorkerIdentity,
		RAGActivities:          handler.TemporalWorkerActivities(),
		FinalizationActivities: handler.TemporalWorkerActivities(),
	})
	if err != nil {
		logger.Error("campus execution-control temporal worker invalid", "error", err.Error())
		os.Exit(1)
	}
	if err := temporalWorkers.Start(); err != nil {
		logger.Error("campus execution-control temporal worker start failed", "error", err.Error())
		os.Exit(1)
	}
	handler.MarkTemporalWorkersStarted(true)
	defer temporalWorkers.Stop()

	server := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      time.Duration(cfg.RequestTimeoutMS+2_000) * time.Millisecond,
		IdleTimeout:       60 * time.Second,
	}

	logger.Info("campus execution-control listening", "address", address)
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case signalValue := <-shutdownSignals:
		logger.Info("campus execution-control draining", "signal", signalValue.String())
		runtimeCancel()
		handler.MarkTemporalWorkersStarted(false)
		temporalWorkers.Stop()
		handler.StartDraining()
		ctx, cancel := context.WithTimeout(
			context.Background(),
			time.Duration(cfg.ShutdownGraceMS)*time.Millisecond,
		)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("campus execution-control graceful shutdown failed", "error", err.Error())
			os.Exit(1)
		}
		if err := handler.Shutdown(ctx); err != nil {
			logger.Error("campus execution-control telemetry shutdown failed", "error", err.Error())
		}
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("campus execution-control failed", "error", err.Error())
			os.Exit(1)
		}
		return
	}

	if err := <-serverErrors; err != nil && err != http.ErrServerClosed {
		logger.Error("campus execution-control failed", "error", err.Error())
		os.Exit(1)
	}
}
