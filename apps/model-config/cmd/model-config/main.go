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

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("model_config.stopped", "error", err)
		os.Exit(1)
	}
}

func run(_ *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cipher, err := modelconfig.LoadCipher(cfg.EncryptionKeyPath)
	if err != nil {
		return err
	}
	store, err := modelconfig.NewStore(context.Background(), cfg.DatabaseURL, cipher)
	if err != nil {
		return err
	}
	defer store.Close()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Handler:           httpapi.New(store),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errs := make(chan error, 1)
	go func() {
		if serveErr := server.ListenAndServe(); serveErr != nil && serveErr != http.ErrServerClosed {
			errs <- serveErr
		}
	}()
	select {
	case <-ctx.Done():
	case err = <-errs:
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	return err
}
