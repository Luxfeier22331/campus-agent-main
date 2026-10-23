package runtimeassembly

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	operationapp "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/runtimeapi"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalclient/control"
)

type APIOwner struct {
	*resources
	server         *httpapi.Server
	reconciler     *executionreconciler.Reconciler
	delivery       *executionapplication.MemoryDeliveryDispatcher
	deliveryCancel context.CancelFunc
	deliveryDone   chan struct{}
}

func NewAPI(cfg config.Config, logger *slog.Logger) (*APIOwner, error) {
	r, err := newResources(cfg, logger)
	if err != nil {
		return nil, err
	}
	payloads, _ := r.execution.store.(executionapplication.RuntimePayloadLifecycle)
	reconciler := executionreconciler.New(executionreconciler.Options{
		Finalizer:        r.execution.finalization,
		Payloads:         payloads,
		Logger:           logger,
		OperationTimeout: time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          &control.Gateway{Starter: r.temporalStarter},
		Store:            r.execution.store,
	})
	runService := executionapplication.NewRunService(executionapplication.RunServiceOptions{
		AdmissionSnapshotBuilder:      r.execution.admission,
		InputLoader:                   r.execution.inputReader.ExecutionInputLoader,
		InputError:                    r.execution.inputReader.ExecutionInputErr,
		Namespace:                     cfg.TemporalNamespace,
		PersonalMemoryRecallAvailable: cfg.MemoryServiceBaseURL != "",
		PersonalMemoryTimeoutSeconds:  cfg.PersonalMemoryTimeoutSeconds,
		ReconcilerWaker:               reconciler,
		Store:                         r.execution.store,
		StoreError:                    r.execution.storeErr,
		TaskQueue:                     cfg.TemporalTaskQueue,
	})
	ownerDeletion := executionapplication.NewOwnerDeletionService(executionapplication.OwnerDeletionOptions{
		Store: r.execution.store, StoreError: r.execution.storeErr,
	})
	var runtimeHandler http.Handler
	if store, ok := r.execution.store.(*executionpersistence.PostgresRunProjectionStore); ok {

		projection := &operationapp.RunProjectionService{Answers: store, StateWriter: store, Writer: r.execution.writer, DeploymentRelease: cfg.DeploymentRelease}
		runtimeHandler = &runtimeapi.Server{
			SharedSecret: cfg.AgentRuntimeSharedSecret, ActivityStore: store, Store: store, MetadataWriter: store, Finalization: r.execution.finalization,
			Input:      &operationapp.RuntimeInputService{Projection: projection, InputReader: r.execution.inputReader, AnswerTransport: cfg.AnswerTransport},
			Projection: projection, Invocation: &executionapplication.RuntimeInvocationService{Receipts: store.Receipts, Runs: projection},
		}
	}
	server := httpapi.NewServerWithOptions(cfg, httpapi.ServerOptions{
		RuntimeHandler:          runtimeHandler,
		Logger:                  logger,
		OwnerDeletion:           ownerDeletion,
		RunProjectionStore:      r.execution.store,
		RunProjectionStoreError: r.execution.storeErr,
		RunService:              runService,
		TemporalStarter:         &control.Gateway{Starter: r.temporalStarter},
		TemporalStarterError:    r.temporalStarterErr,
	})
	owner := &APIOwner{resources: r, server: server, reconciler: reconciler}
	if store, ok := r.execution.store.(*executionpersistence.PostgresRunProjectionStore); ok && cfg.MemoryServiceBaseURL != "" {
		owner.delivery = &executionapplication.MemoryDeliveryDispatcher{Store: store, Client: outboundadapter.NewMemoryClient(cfg.MemoryServiceBaseURL, cfg.MemoryServiceSecret)}
	}
	return owner, nil
}
func (owner *APIOwner) Handler() *httpapi.Server { return owner.server }
func (owner *APIOwner) Start(ctx context.Context) *executionreconciler.Reconciler {
	owner.reconciler.Start(ctx)
	if owner.delivery != nil {
		deliveryCtx, cancel := context.WithCancel(ctx)
		owner.deliveryCancel = cancel
		owner.deliveryDone = make(chan struct{})
		go func() { defer close(owner.deliveryDone); owner.delivery.Run(deliveryCtx) }()
	}
	return owner.reconciler
}
func (owner *APIOwner) StartDraining() { owner.server.StartDraining() }
func (owner *APIOwner) Shutdown(context.Context) error {
	owner.reconciler.Stop()
	if owner.deliveryCancel != nil {
		owner.deliveryCancel()
		<-owner.deliveryDone
	}
	owner.Close()
	return nil
}
