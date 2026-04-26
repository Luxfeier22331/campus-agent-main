package structuredquery

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

func (r *Runtime) loadBundle() (projectionBundle, error) {
	return loadProjectionBundleFromPath(r.projectionPath)
}

func (r *Runtime) loadServiceGuideBundle() (projectionBundle, error) {
	projectionPath := r.serviceGuideProjectionPath
	if projectionPath == "" {
		projectionPath = r.projectionPath
	}
	return loadProjectionBundleFromPath(
		projectionPath,
		"campus_services_service_guide_projection.v1",
		"campus_services_projection_bundle.v1",
	)
}

func loadProjectionBundleFromPath(
	projectionPath string,
	allowedSchemaVersions ...string,
) (projectionBundle, error) {
	if projectionPath == "" {
		return projectionBundle{}, errors.New("projection path is not configured")
	}
	raw, err := os.ReadFile(projectionPath)
	if err != nil {
		return projectionBundle{}, err
	}
	var bundle projectionBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return projectionBundle{}, err
	}
	if len(allowedSchemaVersions) > 0 && !schemaVersionAllowed(
		bundle.SchemaVersion,
		allowedSchemaVersions,
	) {
		return projectionBundle{}, errors.New("projection schema version is not supported")
	}
	return bundle, nil
}

func schemaVersionAllowed(value string, allowedSchemaVersions []string) bool {
	normalized := strings.TrimSpace(value)
	for _, allowed := range allowedSchemaVersions {
		if normalized == allowed {
			return true
		}
	}
	return false
}
