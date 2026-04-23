package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/httpapi"
)

func main() {
	cfg := config.FromEnv()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	bridgeClient := bridge.NewHTTPClient(cfg.BridgeBaseURL, cfg.BridgeSharedSecret)

	server := &http.Server{
		Addr:              address,
		Handler:           httpapi.NewServer(cfg, bridgeClient),
		ReadHeaderTimeout: 5 * time.Second,
	}

	logger.Info("campus go-shell listening", "address", address)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("campus go-shell failed", "error", err.Error())
		os.Exit(1)
	}
}
