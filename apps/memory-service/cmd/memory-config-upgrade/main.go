package main

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/hindsightadapter"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Minute)
	defer cancel()
	if err := hindsightadapter.UpgradeConfig(ctx, hindsightadapter.Options{
		BaseURL: os.Getenv("HINDSIGHT_API_BASE_URL"), APISecret: os.Getenv("HINDSIGHT_API_TENANT_API_KEY"), Timeout: 30 * time.Second,
	}, os.Stdout); err != nil {
		log.Fatal(err)
	}
}
