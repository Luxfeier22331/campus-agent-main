package runtimeassembly

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocspersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioninput"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/hindsightadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/control"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/execution"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	memoryactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/memory"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolcontract"
)

type closeable interface {
	Close()
}

// Owner is the composition-root lifecycle owner. HTTP receives only
// application ports and never closes shared stores or Temporal clients.
type Owner struct {
	server              *httpapi.Server
	executionAdapter    *executionactivities.Adapter
	memoryAdapter       *memoryactivities.Adapter
	finalizationAdapter *finalizationactivities.Adapter
	reconciler          *executionreconciler.Reconciler

	campusDocsIndexStore     campusdocs.IndexStore
	runProjectionStore       executionapplication.RunStore
	personalMemoryStateStore executionapplication.MemoryStore
	temporalStarter          *temporalruntime.Starter

	closeOnce sync.Once
}

func NewOwner(cfg config.Config, logger *slog.Logger) (*Owner, error) {
	ctx := context.Background()
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(ctx, cfg)

	var modelConfigResolver *modelconfigclient.Client
	var modelConfigErr error
	if strings.TrimSpace(cfg.ModelConfigBaseURL) != "" {
		modelConfigResolver, modelConfigErr = modelconfigclient.New(cfg.ModelConfigBaseURL)
	} else {
		modelConfigErr = modelconfigclient.ErrNotConfigured
	}

	campusDocsIndexStore, campusDocsIndexStoreErr := newCampusDocsIndexStore(cfg)
	campusDocsSearcher, campusDocsSearcherErr := outboundadapter.NewCampusDocsSearcher(cfg, modelConfigResolver, logger)

	admissionService := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ToolContract:          toolcontract.Files{},
		AgentDeadlineMS:       cfg.AgentRuntimeDeadlineMS,
		ContextCharLimit:      cfg.AgentRuntimeContextCharLimit,
		CurrentInputCharLimit: cfg.AgentRuntimeInputCharLimit,
		MaxOutputTokens:       cfg.AgentRuntimeMaxOutputTokens,
		ModelTargetResolver:   modelConfigResolver,
		ModelTargetError:      modelConfigErr,
	})

	personalMemoryExecutor, personalMemoryErr := hindsightadapter.New(hindsightadapter.Options{
		APISecret:         cfg.PersonalMemoryAPISecret,
		BaseURL:           cfg.PersonalMemoryBaseURL,
		ContextCharBudget: cfg.PersonalMemoryContextCharBudget,
		OwnerSalt:         cfg.PersonalMemoryOwnerSalt,
		RecallLimit:       cfg.PersonalMemoryRecallLimit,
		RecallMaxTokens:   cfg.PersonalMemoryRecallMaxTokens,
		Timeout:           time.Duration(cfg.PersonalMemoryTimeoutSeconds * float64(time.Second)),
	})
	personalMemoryStateStore, personalMemoryStateErr := newPersonalMemoryStateStore(ctx, cfg)
	if personalMemoryErr == nil && personalMemoryStateErr == nil {
		personalMemoryExecutor = executionapplication.NewFencedExecutor(
			personalMemoryExecutor,
			personalMemoryStateStore,
			cfg.PersonalMemoryOwnerSalt,
			time.Duration(cfg.PersonalMemoryTimeoutSeconds*float64(time.Second)),
		)
	}

	executionInputLoader, executionInputErr := executioninput.NewInputLoader(cfg)
	agentRuntimeClient := outboundadapter.NewAgentRuntimeClient(cfg)
	productCallbackClient := outboundadapter.NewProductCallbackClient(cfg)
	temporalStarter, temporalStarterErr := newTemporalStarter(ctx, cfg)
	var receiptOwner executionapplication.ReceiptStore
	if store, ok := runProjectionStore.(*executionpersistence.PostgresRunProjectionStore); ok {
		receiptOwner = store.Receipts
	}

	writer := projection.New(projection.Writer{Config: cfg, ExecutionInputLoader: executionInputLoader, ExecutionInputErr: executionInputErr, ProductCallbackClient: productCallbackClient, RunProjectionStore: runProjectionStore})
	executionAdapter := executionactivities.New(executionactivities.Adapter{Writer: writer, AgentRuntimeClient: agentRuntimeClient, Receipts: executionapplication.NewReceiptService(receiptOwner)})
	memoryAdapter := memoryactivities.New(memoryactivities.Adapter{Writer: writer, PersonalMemoryExecutor: personalMemoryExecutor, PersonalMemoryErr: personalMemoryErr, PersonalMemoryStateStore: personalMemoryStateStore, PersonalMemoryStateErr: personalMemoryStateErr})
	finalizationAdapter := finalizationactivities.New(finalizationactivities.Adapter{Writer: writer, AdmissionService: admissionService, Logger: logger})
	reconciler := executionreconciler.New(executionreconciler.Options{
		Finalizer:        control.NewFinalizer(finalizationAdapter),
		Logger:           logger,
		OperationTimeout: time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          &control.Gateway{Starter: temporalStarter},
		Store:            runProjectionStore,
	})
	runService := executionapplication.NewRunService(executionapplication.RunServiceOptions{
		AdmissionSnapshotBuilder:      admissionService,
		InputLoader:                   executionInputLoader,
		InputError:                    executionInputErr,
		Namespace:                     cfg.TemporalNamespace,
		PersonalMemoryRecallAvailable: personalMemoryExecutor != nil && personalMemoryErr == nil,
		PersonalMemoryTimeoutSeconds:  cfg.PersonalMemoryTimeoutSeconds,
		ReconcilerWaker:               reconciler,
		Store:                         runProjectionStore,
		StoreError:                    runProjectionStoreErr,
		TaskQueue:                     cfg.TemporalTaskQueue,
	})
	agentToolService := executionapplication.NewAgentToolService(executionapplication.AgentToolServiceOptions{
		CampusDocsIndexStore:      campusDocsIndexStore,
		CampusDocsIndexStoreError: campusDocsIndexStoreErr,
		CampusDocsSearcher:        campusDocsSearcher,
		CampusDocsSearcherError:   campusDocsSearcherErr,
		InputLoader:               executionInputLoader,
		InputError:                executionInputErr,
		PersonalMemoryExecutor:    personalMemoryExecutor,
		PersonalMemoryError:       personalMemoryErr,
		Store:                     runProjectionStore,
		StoreError:                runProjectionStoreErr,
	})
	server := httpapi.NewServerWithOptions(cfg, httpapi.ServerOptions{
		AgentToolService:         agentToolService,
		Logger:                   logger,
		PersonalMemoryStateStore: personalMemoryStateStore,
		PersonalMemoryStateError: personalMemoryStateErr,
		RunProjectionStore:       runProjectionStore,
		RunProjectionStoreError:  runProjectionStoreErr,
		RunService:               runService,
		TemporalStarter:          &control.Gateway{Starter: temporalStarter},
		TemporalStarterError:     temporalStarterErr,
	})
	return &Owner{
		server:                   server,
		executionAdapter:         executionAdapter,
		memoryAdapter:            memoryAdapter,
		finalizationAdapter:      finalizationAdapter,
		reconciler:               reconciler,
		campusDocsIndexStore:     campusDocsIndexStore,
		runProjectionStore:       runProjectionStore,
		personalMemoryStateStore: personalMemoryStateStore,
		temporalStarter:          temporalStarter,
	}, nil
}

func (owner *Owner) StartDraining() {
	if owner != nil && owner.server != nil {
		owner.server.StartDraining()
	}
}

func (owner *Owner) Shutdown(_ context.Context) error {
	if owner == nil {
		return nil
	}
	owner.closeOnce.Do(func() {
		if owner.reconciler != nil {
			owner.reconciler.Stop()
		}
		if owner.temporalStarter != nil {
			owner.temporalStarter.Close()
		}
		if closer, ok := owner.campusDocsIndexStore.(closeable); ok {
			closer.Close()
		}
		if closer, ok := owner.runProjectionStore.(closeable); ok {
			closer.Close()
		}
		if closer, ok := owner.personalMemoryStateStore.(closeable); ok {
			closer.Close()
		}
	})
	return nil
}

func newRunProjectionStore(ctx context.Context, cfg config.Config) (executionapplication.RunStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return nil, nil
	}
	connectCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	store, err := executionpersistence.NewPostgresRunProjectionStore(connectCtx, executionpersistence.PostgresRunProjectionStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
	})
	if err != nil {
		return nil, err
	}
	return store, nil
}

func newCampusDocsIndexStore(cfg config.Config) (campusdocs.IndexStore, error) {
	return campusdocspersistence.NewPostgresIndexStore(cfg.DatabaseURL)
}

func newPersonalMemoryStateStore(ctx context.Context, cfg config.Config) (executionapplication.MemoryStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return memorypersistence.NewInMemoryStateStore(), nil
	}
	connectCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return memorypersistence.NewPostgresStateStore(connectCtx, memorypersistence.PostgresStateStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
	})
}

func newTemporalStarter(ctx context.Context, cfg config.Config) (*temporalruntime.Starter, error) {
	if strings.TrimSpace(cfg.TemporalAddress) == "" && strings.TrimSpace(cfg.TemporalNamespace) == "" {
		return nil, temporalruntime.ErrTemporalStarterNotConfigured
	}
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return NewStarter(connectCtx, temporalruntime.StarterOptions{
		ActivityTaskQueues:       []string{temporalruntime.ActivityTaskQueueCore, temporalruntime.ActivityTaskQueueAgent},
		Address:                  cfg.TemporalAddress,
		Namespace:                cfg.TemporalNamespace,
		TaskQueue:                cfg.TemporalTaskQueue,
		WorkerID:                 cfg.TemporalWorkerIdentity,
		StartTimeout:             time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		WorkflowExecutionTimeout: time.Duration(cfg.TemporalWorkflowExecutionTimeoutSeconds) * time.Second,
	})
}

func (owner *Owner) Handler() *httpapi.Server { return owner.server }
func (owner *Owner) Start(startup, lifetime context.Context, cfg config.Config, logger *slog.Logger) (*Runtime, error) {
	return StartRuntime(startup, lifetime, cfg, owner.executionAdapter, owner.memoryAdapter, owner.finalizationAdapter, owner.reconciler, logger)
}
