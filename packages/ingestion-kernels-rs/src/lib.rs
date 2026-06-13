use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentUnitsValidationReport {
    pub schema_version: String,
    pub unit_count: usize,
    pub error_count: usize,
    pub errors: Vec<String>,
}

pub fn validate_document_units_jsonl(input: &str) -> DocumentUnitsValidationReport {
    let mut unit_count = 0;
    let mut errors = Vec::new();

    for (index, line) in input.lines().enumerate() {
        let line_number = index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        unit_count += 1;
        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                errors.push(format!("line {line_number} invalid JSON: {error}"));
                continue;
            }
        };
        let Some(object) = parsed.as_object() else {
            errors.push(format!("line {line_number} must be a JSON object"));
            continue;
        };
        for field in ["unit_id", "document_id", "text", "metadata"] {
            if !object.contains_key(field) {
                errors.push(format!(
                    "line {line_number} missing required field: {field}"
                ));
            }
        }
    }

    DocumentUnitsValidationReport {
        schema_version: "document_units_validation_report.v1".to_string(),
        unit_count,
        error_count: errors.len(),
        errors,
    }
}

#[cfg(test)]
mod tests {
    use super::validate_document_units_jsonl;

    #[test]
    fn validates_document_units_jsonl_and_reports_missing_required_fields() {
        let report = validate_document_units_jsonl(
            r#"{"unit_id":"u1","document_id":"doc1","text":"hello","metadata":{}}
{"document_id":"doc1","text":"missing id","metadata":{}}
"#,
        );

        assert_eq!(report.schema_version, "document_units_validation_report.v1");
        assert_eq!(report.unit_count, 2);
        assert_eq!(report.error_count, 1);
        assert_eq!(
            report.errors,
            vec!["line 2 missing required field: unit_id"]
        );
    }
}
