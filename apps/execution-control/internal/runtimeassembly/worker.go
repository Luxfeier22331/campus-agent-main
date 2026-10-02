package runtimeassembly

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/execution"
	memoryactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/memory"
)

type WorkerOwner struct {
	*resources
	cfg              config.Config
	executionAdapter *executionactivities.Adapter
	memoryAdapter    *memoryactivities.Adapter
}

func NewWorker(cfg config.Config, logger *slog.Logger) (*WorkerOwner, error) {
	r, err := newResources(cfg, logger)
	if err != nil {
		return nil, err
	}
	var receipts executionapplication.ReceiptStore
	if store, ok := r.runProjectionStore.(*executionpersistence.PostgresRunProjectionStore); ok {
		receipts = store.Receipts
	}
	return &WorkerOwner{
		resources: r, cfg: cfg,
		executionAdapter: executionactivities.New(executionactivities.Adapter{Writer: r.writer, AgentRuntimeClient: outboundadapter.NewAgentRuntimeClient(cfg), Receipts: executionapplication.NewReceiptService(receipts)}),
		memoryAdapter:    memoryactivities.New(memoryactivities.Adapter{Writer: r.writer, PersonalMemoryExecutor: r.personalMemoryExecutor, AsyncMemoryExecutor: r.asyncMemoryExecutor, PersonalMemoryErr: r.personalMemoryErr, PersonalMemoryStateStore: r.personalMemoryStateStore, PersonalMemoryStateErr: r.personalMemoryStateErr, AppendWorkflowReviver: r.temporalStarter}),
	}, nil
}
func (owner *WorkerOwner) Start(ctx context.Context, logger *slog.Logger) (*Runtime, error) {
	return StartWorkers(ctx, owner.cfg, owner.executionAdapter, owner.memoryAdapter, owner.finalizationAdapter, logger)
}
func (owner *WorkerOwner) Handler(runtime *Runtime) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || (r.URL.Path != "/healthz" && r.URL.Path != "/readyz") {
			http.NotFound(w, r)
			return
		}
		code, status := http.StatusOK, "ok"
		if r.URL.Path == "/readyz" {
			if owner.cfg.AppAPIExecutionSharedSecret == "" || subtle.ConstantTimeCompare([]byte(strings.TrimSpace(r.Header.Get("x-worker-origin-auth"))), []byte(strings.TrimSpace(owner.cfg.AppAPIExecutionSharedSecret))) != 1 {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			ready := runtime.Ready() && owner.runProjectionStore != nil && owner.runProjectionStoreErr == nil && owner.personalMemoryStateStore != nil && owner.personalMemoryStateErr == nil
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			defer cancel()
			for _, store := range []any{owner.runProjectionStore, owner.personalMemoryStateStore} {
				if checker, ok := store.(interface{ HealthCheck(context.Context) error }); ok && checker.HealthCheck(ctx) != nil {
					ready = false
				}
			}
			status = "ready"
			if !ready {
				code, status = http.StatusServiceUnavailable, "degraded"
			}
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "runtime_release": owner.cfg.DeploymentRelease})
	})
}
