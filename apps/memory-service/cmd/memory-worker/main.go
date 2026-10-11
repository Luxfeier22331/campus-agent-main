package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/internal/memoryruntimeapp"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/internal/memoryworkflow"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
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
	if c.TemporalAddress == "" || c.CallbackURL == "" || c.CallbackSecret == "" {
		return errors.New("memory worker requires MEMORY_TEMPORAL_ADDRESS, APP_PRODUCT_CALLBACK_BASE_URL and APP_PRODUCT_CALLBACK_SHARED_SECRET")
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
	temporal, err := client.DialContext(ctx, client.Options{HostPort: c.TemporalAddress, Namespace: c.TemporalNamespace})
	if err != nil {
		return err
	}
	defer temporal.Close()
	dispatcher := &memoryworkflow.Dispatcher{Store: r.Store, Client: temporal}
	service := &memoryapplication.Service{OwnerSalt: c.OwnerSalt, TimeoutSeconds: c.Timeout.Seconds(), CommandExecutor: r.Commands, Recaller: r.Recaller, AsyncMemoryExecutor: r.Async, CommandStateStore: r.Store, CallLeaseStore: r.Store, OwnerLifecycleStore: r.Store, AppendWorkflowReviver: dispatcher}
	activities := &memoryworkflow.Activities{Store: r.Store, Service: service, Callback: &memoryworkflow.Callback{BaseURL: c.CallbackURL, Secret: c.CallbackSecret, Client: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}}
	workflows := worker.New(temporal, memoryworkflow.WorkflowQueue, worker.Options{})
	workflows.RegisterWorkflowWithOptions(memoryworkflow.Operation, workflow.RegisterOptions{Name: memoryworkflow.Type})
	operations := worker.New(temporal, memoryworkflow.ActivityQueue, worker.Options{WorkerStopTimeout: c.Timeout + 5*time.Second})
	operations.RegisterActivityWithOptions(activities.Advance, activity.RegisterOptions{Name: "AdvanceMemoryOperation"})
	if err := operations.Start(); err != nil {
		return err
	}
	defer operations.Stop()
	if err := workflows.Start(); err != nil {
		return err
	}
	defer workflows.Stop()
	health := &http.Server{Addr: fmt.Sprintf("%s:%d", c.Host, c.Port), ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/healthz" {
			w.WriteHeader(200)
			return
		}
		if req.URL.Path != "/readyz" {
			w.WriteHeader(404)
			return
		}
		if ctx.Err() != nil || r.Store.HealthCheck(req.Context()) != nil {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	})}
	go func() {
		if e := health.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
			log.Print(e)
			stop()
		}
	}()
	defer func() { _ = health.Close() }()
	dispatcher.Run(ctx)
	return nil
}
