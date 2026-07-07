package autoscaler

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"time"
)

var allowlistedComposeServices = map[string]struct{}{
	"workflow-worker":           {},
	"activity-worker-core":      {},
	"activity-worker-agent":     {},
	"activity-worker-knowledge": {},
}

type ReplicaSource interface {
	ReplicaCounts(context.Context, []string) (map[string]int, error)
}

type Actuator interface {
	Apply(context.Context, []WorkerAutoscalerDecision) ([]Actuation, error)
}

type CommandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type ExecCommandRunner struct{}

func (ExecCommandRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	return command.CombinedOutput()
}

type DockerComposeActuator struct {
	Now              func() time.Time
	ProjectDirectory string
	ProjectName      string
	Runner           CommandRunner
}

type composeServiceRecord struct {
	Service string `json:"Service"`
}

func (a DockerComposeActuator) ReplicaCounts(
	ctx context.Context,
	services []string,
) (map[string]int, error) {
	for _, service := range services {
		if err := assertAllowlistedService(service); err != nil {
			return nil, err
		}
	}
	output, err := a.runCompose(ctx, "ps", "--format", "json")
	if err != nil {
		return nil, err
	}
	records, err := decodeComposeServiceRecords(output)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, service := range services {
		counts[service] = 0
	}
	for _, record := range records {
		service := strings.TrimSpace(record.Service)
		if _, ok := counts[service]; ok {
			counts[service]++
		}
	}
	return counts, nil
}

func (a DockerComposeActuator) Apply(
	ctx context.Context,
	decisions []WorkerAutoscalerDecision,
) ([]Actuation, error) {
	now := time.Now().UTC()
	if a.Now != nil {
		now = a.Now().UTC()
	}
	actuations := make([]Actuation, 0, len(decisions))
	for _, decision := range decisions {
		if err := assertAllowlistedService(decision.TargetService); err != nil {
			return nil, err
		}
		action := "none"
		status := ActuationStatusSkipped
		errorCode := ""
		if decision.CurrentReplicas != decision.DesiredReplicas {
			action = "scale"
			status = ActuationStatusApplied
			if _, err := a.runCompose(
				ctx,
				"up",
				"-d",
				"--scale",
				fmt.Sprintf("%s=%d", decision.TargetService, decision.DesiredReplicas),
				decision.TargetService,
			); err != nil {
				actuations = append(actuations, Actuation{
					ActedAt:       now.Format(time.RFC3339Nano),
					Action:        action,
					ActuationID:   fmt.Sprintf("actuation-%s", decision.DecisionID),
					ActuatorKind:  ActuatorKindDockerCompose,
					DecisionID:    decision.DecisionID,
					ErrorCode:     "docker_compose_scale_failed",
					FromReplicas:  decision.CurrentReplicas,
					Status:        ActuationStatusFailed,
					TargetService: decision.TargetService,
					ToReplicas:    decision.DesiredReplicas,
				})
				return actuations, err
			}
		}
		actuations = append(actuations, Actuation{
			ActedAt:       now.Format(time.RFC3339Nano),
			Action:        action,
			ActuationID:   fmt.Sprintf("actuation-%s", decision.DecisionID),
			ActuatorKind:  ActuatorKindDockerCompose,
			DecisionID:    decision.DecisionID,
			ErrorCode:     errorCode,
			FromReplicas:  decision.CurrentReplicas,
			Status:        status,
			TargetService: decision.TargetService,
			ToReplicas:    decision.DesiredReplicas,
		})
	}
	return actuations, nil
}

func (a DockerComposeActuator) runCompose(
	ctx context.Context,
	args ...string,
) ([]byte, error) {
	runner := a.Runner
	if runner == nil {
		runner = ExecCommandRunner{}
	}
	commandArgs := []string{"compose"}
	if projectName := strings.TrimSpace(a.ProjectName); projectName != "" {
		commandArgs = append(commandArgs, "--project-name", projectName)
	}
	if projectDirectory := strings.TrimSpace(a.ProjectDirectory); projectDirectory != "" {
		commandArgs = append(commandArgs, "--project-directory", projectDirectory)
	}
	commandArgs = append(commandArgs, args...)
	output, err := runner.Run(ctx, "docker", commandArgs...)
	if err != nil {
		return nil, fmt.Errorf("docker %s failed: %w: %s", strings.Join(commandArgs, " "), err, strings.TrimSpace(string(output)))
	}
	return output, nil
}

func decodeComposeServiceRecords(output []byte) ([]composeServiceRecord, error) {
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return nil, fmt.Errorf("docker compose ps returned no services")
	}
	var records []composeServiceRecord
	if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal(output, &records); err != nil {
			return nil, err
		}
		return records, nil
	}
	for _, line := range strings.Split(trimmed, "\n") {
		var record composeServiceRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func assertAllowlistedService(service string) error {
	normalized := strings.TrimSpace(service)
	if normalized == "" {
		return fmt.Errorf("target service is required")
	}
	if _, ok := allowlistedComposeServices[normalized]; ok {
		return nil
	}
	allowed := make([]string, 0, len(allowlistedComposeServices))
	for service := range allowlistedComposeServices {
		allowed = append(allowed, service)
	}
	sort.Strings(allowed)
	return fmt.Errorf("target service %s is not allowlisted; allowed services: %s", normalized, strings.Join(allowed, ", "))
}
