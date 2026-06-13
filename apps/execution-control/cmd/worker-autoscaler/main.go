package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type autoscalerInput struct {
	Environment       string                      `json:"environment"`
	GeneratedAt       string                      `json:"generated_at"`
	Queues            []queueObservation          `json:"queues"`
	DownstreamBudgets map[string]downstreamBudget `json:"downstream_budgets"`
}

type queueObservation struct {
	Name                    string `json:"name"`
	Role                    string `json:"role"`
	Pollers                 int    `json:"pollers"`
	Backlog                 int    `json:"backlog"`
	ScheduleToStartMS       int    `json:"schedule_to_start_ms"`
	CurrentReplicas         int    `json:"current_replicas"`
	MinReplicas             int    `json:"min_replicas"`
	MaxReplicas             int    `json:"max_replicas"`
	TargetScheduleToStartMS int    `json:"target_schedule_to_start_ms"`
}

type downstreamBudget struct {
	Available   bool `json:"available"`
	MaxReplicas int  `json:"max_replicas"`
}

type autoscalerEvidence struct {
	Mode                 string                    `json:"mode"`
	Environment          string                    `json:"environment"`
	GeneratedAt          string                    `json:"generated_at"`
	ObservedAt           string                    `json:"observed_at"`
	WritesExecutionState bool                      `json:"writes_execution_state"`
	DecisionInputs       autoscalerDecisionInputs  `json:"decision_inputs"`
	Decisions            []autoscalerQueueDecision `json:"decisions"`
}

type autoscalerActuationEvidence struct {
	EvidenceContract     string                         `json:"evidence_contract"`
	Mode                 string                         `json:"mode"`
	Environment          string                         `json:"environment"`
	GeneratedAt          string                         `json:"generated_at"`
	ObservedAt           string                         `json:"observed_at"`
	WritesExecutionState bool                           `json:"writes_execution_state"`
	Operations           []autoscalerActuationOperation `json:"operations"`
}

type autoscalerActuationOperation struct {
	TaskQueue       string `json:"task_queue"`
	Role            string `json:"role"`
	CurrentReplicas int    `json:"current_replicas"`
	DesiredReplicas int    `json:"desired_replicas"`
	Action          string `json:"action"`
	Reason          string `json:"reason"`
}

type autoscalerDecisionInputs struct {
	QueueCount int `json:"queue_count"`
}

type autoscalerQueueDecision struct {
	TaskQueue        string `json:"task_queue"`
	Role             string `json:"role"`
	CurrentReplicas  int    `json:"current_replicas"`
	DesiredReplicas  int    `json:"desired_replicas"`
	MinReplicas      int    `json:"min_replicas"`
	MaxReplicas      int    `json:"max_replicas"`
	Pollers          int    `json:"pollers"`
	Backlog          int    `json:"backlog"`
	ScheduleToStart  int    `json:"schedule_to_start_ms"`
	DownstreamMax    int    `json:"downstream_max_replicas,omitempty"`
	Reason           string `json:"reason"`
	EvidenceContract string `json:"evidence_contract"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	options, err := parseOptions(args)
	if err != nil {
		return err
	}
	input, err := readInput(options.inputPath)
	if err != nil {
		return err
	}
	evidence, err := buildEvidence(input, time.Now().UTC(), options.mode)
	if err != nil {
		return err
	}
	if err := writeEvidence(options.evidencePath, evidence); err != nil {
		return err
	}
	if options.mode == "apply" {
		return writeEvidence(
			options.actuatorEvidencePath,
			buildActuationEvidence(input, evidence),
		)
	}
	return nil
}

type commandOptions struct {
	actuatorEvidencePath string
	evidencePath         string
	inputPath            string
	mode                 string
}

func parseOptions(args []string) (commandOptions, error) {
	options := commandOptions{mode: "dry-run"}
	flags := flag.NewFlagSet("worker-autoscaler", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.mode, "mode", options.mode, "autoscaler mode: dry-run or apply")
	flags.StringVar(&options.inputPath, "input-path", "", "path to autoscaler observation input JSON")
	flags.StringVar(&options.evidencePath, "evidence-path", "", "path to autoscaler decision evidence JSON")
	flags.StringVar(
		&options.actuatorEvidencePath,
		"actuator-evidence-path",
		"",
		"path to apply-mode ops-plane actuation evidence JSON",
	)
	if err := flags.Parse(args); err != nil {
		return commandOptions{}, err
	}
	options.mode = strings.TrimSpace(options.mode)
	if options.mode == "" {
		options.mode = "dry-run"
	}
	if options.mode == "dry_run" {
		options.mode = "dry-run"
	}
	if options.mode != "dry-run" && options.mode != "apply" {
		return commandOptions{}, fmt.Errorf("mode must be dry-run or apply")
	}
	missing := []string{}
	if strings.TrimSpace(options.inputPath) == "" {
		missing = append(missing, "input-path")
	}
	if strings.TrimSpace(options.evidencePath) == "" {
		missing = append(missing, "evidence-path")
	}
	if options.mode == "apply" && strings.TrimSpace(options.actuatorEvidencePath) == "" {
		missing = append(missing, "actuator-evidence-path")
	}
	if len(missing) > 0 {
		return commandOptions{}, fmt.Errorf("%s required", strings.Join(missing, ", "))
	}
	return options, nil
}

func readInput(path string) (autoscalerInput, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return autoscalerInput{}, err
	}
	var input autoscalerInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return autoscalerInput{}, err
	}
	return input, validateInput(input)
}

func validateInput(input autoscalerInput) error {
	if strings.TrimSpace(input.Environment) == "" {
		return errors.New("environment is required")
	}
	if len(input.Queues) == 0 {
		return errors.New("at least one task queue observation is required")
	}
	for index, queue := range input.Queues {
		if strings.TrimSpace(queue.Name) == "" {
			return fmt.Errorf("queues[%d].name is required", index)
		}
		if strings.TrimSpace(queue.Role) == "" {
			return fmt.Errorf("queues[%d].role is required", index)
		}
		if queue.CurrentReplicas < 0 || queue.MinReplicas < 0 || queue.MaxReplicas < 0 {
			return fmt.Errorf("queues[%d] replicas must be non-negative", index)
		}
		if queue.MaxReplicas > 0 && queue.MinReplicas > queue.MaxReplicas {
			return fmt.Errorf("queues[%d].min_replicas exceeds max_replicas", index)
		}
		budget, ok := input.DownstreamBudgets[queue.Role]
		if ok && !budget.Available {
			return fmt.Errorf("downstream budget for role %s is unavailable", queue.Role)
		}
	}
	return nil
}

func buildEvidence(input autoscalerInput, now time.Time, mode string) (autoscalerEvidence, error) {
	decisions := make([]autoscalerQueueDecision, 0, len(input.Queues))
	for _, queue := range input.Queues {
		decision, err := decideQueue(input.DownstreamBudgets, queue, mode)
		if err != nil {
			return autoscalerEvidence{}, err
		}
		decisions = append(decisions, decision)
	}
	return autoscalerEvidence{
		Mode:                 evidenceModeForMode(mode),
		Environment:          input.Environment,
		GeneratedAt:          input.GeneratedAt,
		ObservedAt:           now.Format(time.RFC3339Nano),
		WritesExecutionState: false,
		DecisionInputs: autoscalerDecisionInputs{
			QueueCount: len(input.Queues),
		},
		Decisions: decisions,
	}, nil
}

func decideQueue(
	budgets map[string]downstreamBudget,
	queue queueObservation,
	mode string,
) (autoscalerQueueDecision, error) {
	desired := queue.CurrentReplicas
	reason := "within_target"
	if queue.Pollers <= 0 {
		desired = maxInt(queue.CurrentReplicas+1, queue.MinReplicas)
		reason = "pollers_missing"
	} else if queue.Backlog > 0 || exceedsLatencyTarget(queue) {
		desired = maxInt(queue.CurrentReplicas+1, queue.MinReplicas)
		reason = "backlog_or_latency"
	}
	if queue.MaxReplicas > 0 {
		desired = minInt(desired, queue.MaxReplicas)
	}
	downstreamMax := 0
	if budget, ok := budgets[queue.Role]; ok {
		if !budget.Available {
			return autoscalerQueueDecision{}, fmt.Errorf(
				"downstream budget for role %s is unavailable",
				queue.Role,
			)
		}
		downstreamMax = budget.MaxReplicas
		if budget.MaxReplicas > 0 {
			desired = minInt(desired, budget.MaxReplicas)
		}
	}
	desired = maxInt(desired, queue.MinReplicas)
	return autoscalerQueueDecision{
		TaskQueue:        queue.Name,
		Role:             queue.Role,
		CurrentReplicas:  queue.CurrentReplicas,
		DesiredReplicas:  desired,
		MinReplicas:      queue.MinReplicas,
		MaxReplicas:      queue.MaxReplicas,
		Pollers:          queue.Pollers,
		Backlog:          queue.Backlog,
		ScheduleToStart:  queue.ScheduleToStartMS,
		DownstreamMax:    downstreamMax,
		Reason:           reason,
		EvidenceContract: evidenceContractForMode(mode),
	}, nil
}

func buildActuationEvidence(
	input autoscalerInput,
	decision autoscalerEvidence,
) autoscalerActuationEvidence {
	operations := make([]autoscalerActuationOperation, 0, len(decision.Decisions))
	for _, item := range decision.Decisions {
		action := "none"
		if item.CurrentReplicas != item.DesiredReplicas {
			action = "scale"
		}
		operations = append(operations, autoscalerActuationOperation{
			TaskQueue:       item.TaskQueue,
			Role:            item.Role,
			CurrentReplicas: item.CurrentReplicas,
			DesiredReplicas: item.DesiredReplicas,
			Action:          action,
			Reason:          item.Reason,
		})
	}
	return autoscalerActuationEvidence{
		EvidenceContract:     "worker-autoscaler-actuation-evidence-v1",
		Mode:                 "apply",
		Environment:          input.Environment,
		GeneratedAt:          input.GeneratedAt,
		ObservedAt:           decision.ObservedAt,
		WritesExecutionState: false,
		Operations:           operations,
	}
}

func evidenceContractForMode(mode string) string {
	if mode == "apply" {
		return "worker-autoscaler-actuation-decision-v1"
	}
	return "worker-autoscaler-dry-run-v1"
}

func evidenceModeForMode(mode string) string {
	if mode == "apply" {
		return "apply"
	}
	return "dry_run"
}

func exceedsLatencyTarget(queue queueObservation) bool {
	return queue.TargetScheduleToStartMS > 0 &&
		queue.ScheduleToStartMS > queue.TargetScheduleToStartMS
}

func writeEvidence(path string, evidence any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o600)
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
