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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeassembly"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error(
			"execution_control.runtime_stopped",
			"event_type", "execution_control.runtime_stopped",
			"status", "failed",
			"error_code", "runtime_stopped",
			"source", "process",
		)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.LoadRuntimeFromEnv()
	if err != nil {
		return fmt.Errorf("load runtime config: %w", err)
	}

	signalContext, stopSignals := signal.NotifyContext(
		context.Background(),
		syscall.SIGINT,
		syscall.SIGTERM,
	)
	defer stopSignals()
	runtimeContext, cancelRuntime := context.WithCancel(context.Background())
	defer cancelRuntime()

	owner, err := newRuntimeOwner(cfg, logger)
	if err != nil {
		return fmt.Errorf("build execution-control runtime: %w", err)
	}
	runtime, err := runtimeassembly.StartRuntime(
		signalContext,
		runtimeContext,
		cfg,
		owner.adapter,
		owner.reconciler,
		logger,
	)
	if err != nil {
		_ = owner.Shutdown(context.Background())
		return err
	}
	requestTracker := newRequestTracker(owner.server)
	gatewayServer := newHTTPServer(
		fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		requestTracker,
		time.Duration(cfg.RequestTimeoutMS+2_000)*time.Millisecond,
	)
	serverErrors := make(chan error, 1)
	startHTTPServer("execution-control", gatewayServer, serverErrors, logger)

	var runtimeErr error
	select {
	case <-signalContext.Done():
		logger.Info(
			"execution_control.runtime_draining",
			"event_type", "execution_control.runtime_draining",
			"status", "draining",
			"source", "process",
		)
	case runtimeErr = <-runtime.Errors():
	case runtimeErr = <-serverErrors:
	}

	if err := shutdownExecutionRuntime(
		gatewayServer,
		requestTracker,
		runtime,
		owner,
		cancelRuntime,
		time.Duration(cfg.ShutdownGraceMS)*time.Millisecond,
	); err != nil && runtimeErr == nil {
		runtimeErr = err
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
	logger.Info(
		"execution_control.server_listening",
		"event_type", "execution_control.server_listening",
		"status", "ready",
		"source", name,
	)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrors <- fmt.Errorf("%s HTTP server: %w", name, err)
		}
	}()
}
