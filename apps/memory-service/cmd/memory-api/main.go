package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/internal/memoryhttp"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/internal/memoryruntimeapp"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	c, err := memoryruntimeapp.LoadConfig(nil)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	r := memoryruntimeapp.NewResources(ctx, c)
	if r.StoreErr != nil {
		return r.StoreErr
	}
	defer r.Store.Close()
	if r.ProviderErr != nil {
		return r.ProviderErr
	}
	if err := r.Store.HealthCheck(ctx); err != nil {
		return err
	}
	server := &http.Server{Addr: fmt.Sprintf("%s:%d", c.Host, c.Port), ReadHeaderTimeout: 10 * time.Second, Handler: &memoryhttp.Server{Management: r.Management, Admission: r.Admission, Requests: r.Store, Profile: r.Profile, Recaller: r.Recaller, SharedSecret: c.SharedSecret, Ready: r.Store.HealthCheck}}
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	select {
	case err := <-result:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), c.Timeout+5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}
