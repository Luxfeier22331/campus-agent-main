package main

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/cluster-private-ingress/internal/ingress"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	handler, err := ingress.New(ingress.Config{
		EdgeSecret:    os.Getenv("EDGE_INGRESS_SHARED_SECRET"),
		ControlURL:    os.Getenv("EXECUTION_CONTROL_BASE_URL"),
		ControlSecret: os.Getenv("EXECUTION_CONTROL_INGRESS_SHARED_SECRET"),
		MemoryURL:     os.Getenv("MEMORY_SERVICE_BASE_URL"),
		MemorySecret:  os.Getenv("MEMORY_INTERNAL_SHARED_SECRET"),
	})
	if err != nil {
		log.Fatal(err)
	}
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = ":8000"
	}
	server := &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 120 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	done := make(chan struct{})
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 110*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
		}
		close(done)
	}()
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-done
}
