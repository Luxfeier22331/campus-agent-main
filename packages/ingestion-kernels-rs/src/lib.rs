use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::error::Error;
use std::path::Path;
use tokenizers::Tokenizer;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentUnitsValidationReport {
    pub schema_version: String,
    pub unit_count: usize,
    pub error_count: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IngestionChunkSet {
    pub schema_version: String,
    pub chunk_count: usize,
    pub chunks: Vec<IngestionChunk>,
    pub error_count: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IngestionChunk {
    pub chunk_id: String,
    pub document_id: String,
    pub unit_ids: Vec<String>,
    pub text: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseManifestValidationReport {
    pub schema_version: String,
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

pub fn chunk_document_units_jsonl(input: &str, max_chars_per_chunk: usize) -> IngestionChunkSet {
    let mut errors = Vec::new();
    let mut chunks = Vec::new();
    let mut current_document_id = String::new();
    let mut current_unit_ids: Vec<String> = Vec::new();
    let mut current_texts: Vec<String> = Vec::new();

    let max_chars = max_chars_per_chunk.max(1);
    for (index, line) in input.lines().enumerate() {
        let line_number = index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
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
        let Some(unit_id) = object.get("unit_id").and_then(Value::as_str) else {
            errors.push(format!(
                "line {line_number} missing required field: unit_id"
            ));
            continue;
        };
        let Some(document_id) = object.get("document_id").and_then(Value::as_str) else {
            errors.push(format!(
                "line {line_number} missing required field: document_id"
            ));
            continue;
        };
        let Some(text) = object.get("text").and_then(Value::as_str) else {
            errors.push(format!("line {line_number} missing required field: text"));
            continue;
        };

        let should_flush = !current_unit_ids.is_empty()
            && (current_document_id != document_id
                || merged_text_len_with(&current_texts, text) > max_chars);
        if should_flush {
            push_chunk(
                &mut chunks,
                &current_document_id,
                &current_unit_ids,
                &current_texts,
            );
            current_unit_ids.clear();
            current_texts.clear();
        }
        current_document_id = document_id.to_string();
        current_unit_ids.push(unit_id.to_string());
        current_texts.push(text.to_string());
    }
    if !current_unit_ids.is_empty() {
        push_chunk(
            &mut chunks,
            &current_document_id,
            &current_unit_ids,
            &current_texts,
        );
    }

    IngestionChunkSet {
        schema_version: "ingestion_chunk_set.v1".to_string(),
        chunk_count: chunks.len(),
        chunks,
        error_count: errors.len(),
        errors,
    }
}

pub fn validate_release_manifest_json(input: &str) -> ReleaseManifestValidationReport {
    let mut errors = Vec::new();
    let parsed: Value = match serde_json::from_str(input) {
        Ok(value) => value,
        Err(error) => {
            return ReleaseManifestValidationReport {
                schema_version: "ingestion_release_manifest_validation_report.v1".to_string(),
                error_count: 1,
                errors: vec![format!("invalid JSON: {error}")],
            };
        }
    };
    let Some(object) = parsed.as_object() else {
        return ReleaseManifestValidationReport {
            schema_version: "ingestion_release_manifest_validation_report.v1".to_string(),
            error_count: 1,
            errors: vec!["manifest must be a JSON object".to_string()],
        };
    };
    for field in [
        "schema_version",
        "release_id",
        "corpus",
        "collection",
        "artifacts",
    ] {
        if !object.contains_key(field) {
            errors.push(format!("missing required field: {field}"));
        }
    }
    if object.get("schema_version").and_then(Value::as_str) != Some("ingestion_release_manifest.v1")
    {
        errors.push("schema_version must be ingestion_release_manifest.v1".to_string());
    }
    match object.get("artifacts") {
        Some(Value::Array(items)) if !items.is_empty() => {
            for (index, item) in items.iter().enumerate() {
                let Some(artifact) = item.as_object() else {
                    errors.push(format!("artifacts[{index}] must be a JSON object"));
                    continue;
                };
                for field in ["kind", "uri", "digest"] {
                    if !artifact.contains_key(field) {
                        errors.push(format!(
                            "artifacts[{index}] missing required field: {field}"
                        ));
                    }
                }
            }
        }
        Some(Value::Array(_)) => errors.push("artifacts must not be empty".to_string()),
        Some(_) => errors.push("artifacts must be an array".to_string()),
        None => {}
    }

    ReleaseManifestValidationReport {
        schema_version: "ingestion_release_manifest_validation_report.v1".to_string(),
        error_count: errors.len(),
        errors,
    }
}

pub fn count_tokens_from_tokenizer_json(
    tokenizer_json_path: impl AsRef<Path>,
    text: &str,
) -> Result<usize, Box<dyn Error + Send + Sync>> {
    let tokenizer = Tokenizer::from_file(tokenizer_json_path)?;
    let encoding = tokenizer.encode(text, false)?;
    Ok(encoding.len())
}

fn merged_text_len_with(current_texts: &[String], next_text: &str) -> usize {
    let current_len: usize = current_texts.iter().map(|text| text.chars().count()).sum();
    let separators = current_texts.len();
    current_len + separators + next_text.chars().count()
}

fn push_chunk(
    chunks: &mut Vec<IngestionChunk>,
    document_id: &str,
    unit_ids: &[String],
    texts: &[String],
) {
    chunks.push(IngestionChunk {
        chunk_id: format!("{document_id}::chunk::{:06}", chunks.len() + 1),
        document_id: document_id.to_string(),
        unit_ids: unit_ids.to_vec(),
        text: texts.join("\n"),
    });
}

#[cfg(test)]
mod tests {
    use super::{
        chunk_document_units_jsonl, count_tokens_from_tokenizer_json, validate_document_units_jsonl,
        validate_release_manifest_json,
    };
    use std::fs;

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

    #[test]
    fn chunks_document_units_jsonl_into_traceable_chunk_set() {
        let chunk_set = chunk_document_units_jsonl(
            r#"{"unit_id":"u1","document_id":"doc1","text":"第一段内容","metadata":{"heading":"总则"}}
{"unit_id":"u2","document_id":"doc1","text":"第二段内容","metadata":{"heading":"细则"}}
"#,
            4,
        );

        assert_eq!(chunk_set.schema_version, "ingestion_chunk_set.v1");
        assert_eq!(chunk_set.chunk_count, 2);
        assert_eq!(chunk_set.chunks[0].chunk_id, "doc1::chunk::000001");
        assert_eq!(chunk_set.chunks[0].document_id, "doc1");
        assert_eq!(chunk_set.chunks[0].unit_ids, vec!["u1"]);
        assert_eq!(chunk_set.chunks[0].text, "第一段内容");
        assert_eq!(chunk_set.error_count, 0);
    }

    #[test]
    fn release_manifest_validation_reports_missing_required_fields() {
        let report = validate_release_manifest_json(
            r#"{
  "schema_version": "ingestion_release_manifest.v1",
  "release_id": "student-rules-release-001",
  "collection": "student_rules",
  "artifacts": [
    {"kind": "chunks", "uri": "s3://bucket/chunks.jsonl", "digest": "sha256:abc"}
  ]
}"#,
        );

        assert_eq!(
            report.schema_version,
            "ingestion_release_manifest_validation_report.v1"
        );
        assert_eq!(report.error_count, 1);
        assert_eq!(report.errors, vec!["missing required field: corpus"]);
    }

    #[test]
    fn counts_tokens_with_local_tokenizer_json_without_special_tokens() {
        let temp_dir = std::env::temp_dir().join(format!(
            "campus-tokenizer-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&temp_dir).unwrap();
        let tokenizer_path = temp_dir.join("tokenizer.json");
        fs::write(
            &tokenizer_path,
            r#"{
  "version": "1.0",
  "truncation": null,
  "padding": null,
  "added_tokens": [
    {"id": 2, "content": "[CLS]", "single_word": false, "lstrip": false, "rstrip": false, "normalized": false, "special": true}
  ],
  "normalizer": null,
  "pre_tokenizer": {"type": "Whitespace"},
  "post_processor": {
    "type": "TemplateProcessing",
    "single": [{"SpecialToken": {"id": "[CLS]", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}}],
    "pair": [{"SpecialToken": {"id": "[CLS]", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}}, {"Sequence": {"id": "B", "type_id": 0}}],
    "special_tokens": {"[CLS]": {"id": "[CLS]", "ids": [2], "tokens": ["[CLS]"]}}
  },
  "decoder": null,
  "model": {
    "type": "WordLevel",
    "vocab": {"hello": 0, "world": 1, "[CLS]": 2, "[UNK]": 3},
    "unk_token": "[UNK]"
  }
}"#,
        )
        .unwrap();

        let count = count_tokens_from_tokenizer_json(&tokenizer_path, "hello world").unwrap();

        assert_eq!(count, 2);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn fails_closed_when_tokenizer_json_is_missing() {
        let error = count_tokens_from_tokenizer_json("/missing/tokenizer.json", "hello")
            .expect_err("missing tokenizer file should fail");

        assert!(!error.to_string().is_empty());
    }
}
