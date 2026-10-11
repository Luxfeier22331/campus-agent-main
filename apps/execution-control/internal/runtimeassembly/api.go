package runtimeassembly

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	operationapp "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/operation"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/control"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
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
	var client executionapplication.CampusSearchClient
	if cfg.RetrievalBaseURL != "" {
		campusSearchClient, campusSearchClientErr := outboundadapter.NewCampusSearchHTTPClient(
			cfg.RetrievalBaseURL,
			cfg.RetrievalInternalToken,
			time.Duration(cfg.CampusSearchTimeoutMS)*time.Millisecond,
		)
		if campusSearchClientErr != nil {
			return nil, campusSearchClientErr
		}
		client = campusSearchClient
	}
	reconciler := executionreconciler.New(executionreconciler.Options{
		Finalizer:        r.execution.finalization,
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
		PersonalMemoryRecallAvailable: r.memory.recaller != nil && r.memory.providerErr == nil,
		PersonalMemoryTimeoutSeconds:  cfg.PersonalMemoryTimeoutSeconds,
		ReconcilerWaker:               reconciler,
		Store:                         r.execution.store,
		StoreError:                    r.execution.storeErr,
		TaskQueue:                     cfg.TemporalTaskQueue,
		RuntimePercent:                cfg.AgentRuntimePercent,
		MemoryExternal:                cfg.MemoryServiceBaseURL != "",
	})
	authorizer := executionapplication.NewRunToolAuthorizer(executionapplication.RunToolAuthorizerOptions{
		Store: r.execution.store, StoreError: r.execution.storeErr, InputLoader: r.execution.inputReader.ExecutionInputLoader, InputError: r.execution.inputReader.ExecutionInputErr,
	})
	diagnostics, _ := r.execution.store.(campusdiagnostics.Store)
	campusSearchTool := executionapplication.NewCampusSearchToolService(executionapplication.CampusSearchToolServiceOptions{Authorizer: authorizer, CampusSearchClient: client, Store: r.execution.store, Diagnostics: diagnostics})
	personalMemoryRecallTool := executionapplication.NewPersonalMemoryRecallToolService(executionapplication.PersonalMemoryRecallToolServiceOptions{Authorizer: authorizer, PersonalMemoryExecutor: r.memory.recaller, PersonalMemoryError: r.memory.providerErr})
	memoryManagement := memoryapplication.NewMemoryManagementService(memoryapplication.MemoryManagementOptions{
		Store: r.memory.store, StoreError: r.memory.storeErr,
		OwnerSalt: cfg.PersonalMemoryOwnerSalt,
		Starter:   &control.Gateway{Starter: r.temporalStarter}, StarterError: r.temporalStarterErr,
	})
	ownerDeletion := executionapplication.NewOwnerDeletionService(executionapplication.OwnerDeletionOptions{
		Store: r.execution.store, StoreError: r.execution.storeErr, Memory: memoryManagement, MemoryExternal: cfg.MemoryServiceBaseURL != "",
	})
	var runtimeHandler http.Handler
	if store, ok := r.execution.store.(*executionpersistence.PostgresRunProjectionStore); ok {
		runtimeHandler = &runtimeapi.Server{SharedSecret: cfg.AgentRuntimeSharedSecret, Store: store, MetadataWriter: store, Receipts: store.Receipts, Finalization: r.execution.finalization, Operations: &operationapp.OperationService{StateWriter: store, Writer: r.execution.writer.Application(context.Background()), InputReader: r.execution.inputReader, Options: operationapp.Options{AnswerTransport: cfg.AnswerTransport, Configured: true, DeploymentRelease: cfg.DeploymentRelease}, Receipts: executionapplication.NewReceiptService(store.Receipts)}}
	}
	server := httpapi.NewServerWithOptions(cfg, httpapi.ServerOptions{
		RuntimeHandler:           runtimeHandler,
		PersonalMemoryReader:     r.memory.reader,
		CampusSearchTool:         campusSearchTool,
		PersonalMemoryRecallTool: personalMemoryRecallTool,
		Logger:                   logger,
		MemoryManagement:         memoryManagement,
		OwnerDeletion:            ownerDeletion,
		RunProjectionStore:       r.execution.store,
		RunProjectionStoreError:  r.execution.storeErr,
		RunService:               runService,
		TemporalStarter:          &control.Gateway{Starter: r.temporalStarter},
		TemporalStarterError:     r.temporalStarterErr,
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
