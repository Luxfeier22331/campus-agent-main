use jsonschema::Validator;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::error::Error;
use std::path::{Path, PathBuf};
use text_splitter::{ChunkCapacity, ChunkConfig, TextSplitter};
use tokenizers::Tokenizer;

const CANONICAL_DOCUMENT_UNIT_SCHEMA_JSON: &str =
    include_str!("../../ingestion-contracts/schemas/canonical-document-units.v1.schema.json");
const INGESTION_RELEASE_MANIFEST_SCHEMA_JSON: &str =
    include_str!("../../ingestion-contracts/schemas/ingestion-release-manifest.v2.schema.json");

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
    pub doc_id: String,
    pub unit_ids: Vec<String>,
    pub text: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseManifestValidationReport {
    pub schema_version: String,
    pub error_count: usize,
    pub errors: Vec<String>,
}

pub struct ChunkDocumentUnitsOptions {
    pub chunk_size: usize,
    pub max_tokens: usize,
    pub min_tokens: usize,
    pub overlap: usize,
    pub tokenizer_json_path: PathBuf,
}

pub fn validate_document_units_jsonl(input: &str) -> DocumentUnitsValidationReport {
    let mut unit_count = 0;
    let mut errors = Vec::new();
    let validator = validator_for_schema(document_unit_schema())
        .expect("embedded document unit schema must compile");

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
        errors.extend(validation_errors(&validator, &parsed, Some(line_number)));
    }

    DocumentUnitsValidationReport {
        schema_version: "document_units_validation_report.v1".to_string(),
        unit_count,
        error_count: errors.len(),
        errors,
    }
}

pub fn chunk_document_units_jsonl(
    input: &str,
    options: ChunkDocumentUnitsOptions,
) -> Result<IngestionChunkSet, Box<dyn Error + Send + Sync>> {
    validate_chunk_options(&options)?;
    let mut tokenizer = Tokenizer::from_file(&options.tokenizer_json_path)?;
    tokenizer.with_truncation(None)?;
    tokenizer.with_padding(None);

    let mut errors = Vec::new();
    let mut chunks = Vec::new();
    let validator = validator_for_schema(document_unit_schema())
        .expect("embedded document unit schema must compile");
    let splitter = TextSplitter::new(
        ChunkConfig::new(
            ChunkCapacity::new(options.chunk_size)
                .with_max(options.max_tokens)
                .expect("chunk options validate max_tokens"),
        )
        .with_sizer(tokenizer.clone())
        .with_overlap(options.overlap)?,
    );

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
        let schema_errors = validation_errors(&validator, &parsed, Some(line_number));
        if !schema_errors.is_empty() {
            errors.extend(schema_errors);
            continue;
        };
        let object = parsed.as_object().expect("schema validates object");
        let unit_id = object
            .get("chunk_id")
            .and_then(Value::as_str)
            .expect("schema validates chunk_id");
        let doc_id = object
            .get("doc_id")
            .and_then(Value::as_str)
            .expect("schema validates doc_id");
        let text = object
            .get("clean_text")
            .and_then(Value::as_str)
            .expect("schema validates clean_text");

        for text_chunk in splitter.chunks(text) {
            if token_count(&tokenizer, text_chunk)? > options.max_tokens {
                errors.push(format!("line {line_number} chunk exceeds max_tokens"));
                continue;
            }
            push_or_merge_chunk(
                &mut chunks,
                &tokenizer,
                &options,
                doc_id,
                unit_id,
                text_chunk,
            )?;
        }
    }

    Ok(IngestionChunkSet {
        schema_version: "ingestion_chunk_set.v1".to_string(),
        chunk_count: chunks.len(),
        chunks,
        error_count: errors.len(),
        errors,
    })
}

pub fn validate_release_manifest_json(input: &str) -> ReleaseManifestValidationReport {
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
    let validator = validator_for_schema(release_manifest_schema())
        .expect("embedded release manifest schema must compile");
    let mut errors = validation_errors(&validator, &parsed, None);
    if errors.is_empty() {
        errors.extend(release_manifest_consistency_errors(&parsed));
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

fn token_count(tokenizer: &Tokenizer, text: &str) -> Result<usize, Box<dyn Error + Send + Sync>> {
    let encoding = tokenizer.encode(text, false)?;
    Ok(encoding.len())
}

fn push_chunk(chunks: &mut Vec<IngestionChunk>, doc_id: &str, unit_ids: &[String], text: &str) {
    let chunk_number = chunks.iter().filter(|chunk| chunk.doc_id == doc_id).count() + 1;
    chunks.push(IngestionChunk {
        chunk_id: format!("{doc_id}::chunk::{chunk_number:06}"),
        doc_id: doc_id.to_string(),
        unit_ids: unit_ids.to_vec(),
        text: text.to_string(),
    });
}

fn push_or_merge_chunk(
    chunks: &mut Vec<IngestionChunk>,
    tokenizer: &Tokenizer,
    options: &ChunkDocumentUnitsOptions,
    doc_id: &str,
    unit_id: &str,
    text: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let unit_id_string = unit_id.to_string();
    let can_merge = match chunks.last() {
        Some(chunk) if chunk.doc_id == doc_id => {
            token_count(tokenizer, &chunk.text)? < options.min_tokens
        }
        _ => false,
    };
    if can_merge {
        let previous = chunks
            .last_mut()
            .expect("can_merge requires previous chunk");
        let merged_text = format!("{}\n{}", previous.text, text);
        if token_count(tokenizer, &merged_text)? <= options.max_tokens {
            previous.text = merged_text;
            previous.unit_ids.push(unit_id_string);
            return Ok(());
        }
    }
    push_chunk(chunks, doc_id, &[unit_id_string], text);
    Ok(())
}

fn release_manifest_consistency_errors(value: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let mut seen_uris = HashSet::new();
    let mut seen_kind_uris = HashSet::new();
    let Some(artifacts) = value.get("artifacts").and_then(Value::as_array) else {
        return errors;
    };
    for (index, artifact) in artifacts.iter().enumerate() {
        let digest = artifact
            .get("digest")
            .and_then(Value::as_str)
            .expect("schema validates digest");
        if !is_sha256_digest(digest) {
            errors.push(format!(
                "artifacts[{index}] digest must be sha256 lowercase hex"
            ));
        }
        let uri = artifact
            .get("uri")
            .and_then(Value::as_str)
            .expect("schema validates uri");
        if !seen_uris.insert(uri.to_string()) {
            errors.push(format!("duplicate artifact uri: {uri}"));
        }
        let kind = artifact
            .get("kind")
            .and_then(Value::as_str)
            .expect("schema validates kind");
        let kind_uri = format!("{kind}\n{uri}");
        if !seen_kind_uris.insert(kind_uri) {
            errors.push(format!("duplicate artifact kind+uri: {kind} {uri}"));
        }
    }
    errors
}

fn is_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .chars()
                .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    })
}

fn validate_chunk_options(
    options: &ChunkDocumentUnitsOptions,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    if options.chunk_size == 0 {
        return Err("chunk_size must be greater than zero".into());
    }
    if options.max_tokens == 0 {
        return Err("max_tokens must be greater than zero".into());
    }
    if options.min_tokens == 0 {
        return Err("min_tokens must be greater than zero".into());
    }
    if options.chunk_size > options.max_tokens {
        return Err("chunk_size must be less than or equal to max_tokens".into());
    }
    if options.min_tokens > options.max_tokens {
        return Err("min_tokens must be less than or equal to max_tokens".into());
    }
    if options.overlap >= options.chunk_size {
        return Err("overlap must be less than chunk_size".into());
    }
    Ok(())
}

fn validator_for_schema(schema: Value) -> Result<Validator, jsonschema::ValidationError<'static>> {
    jsonschema::validator_for(&schema)
}

fn validation_errors(
    validator: &Validator,
    value: &Value,
    line_number: Option<usize>,
) -> Vec<String> {
    validator
        .iter_errors(value)
        .map(|error| match line_number {
            Some(line) => format!("line {line} {}", normalize_schema_error(&error.to_string())),
            None => normalize_schema_error(&error.to_string()),
        })
        .collect()
}

fn normalize_schema_error(error: &str) -> String {
    error
        .replace(
            "\"doc_id\" is a required property",
            "missing required field: doc_id",
        )
        .replace(
            "\"version_id\" is a required property",
            "missing required field: version_id",
        )
        .replace(
            "\"chunk_id\" is a required property",
            "missing required field: chunk_id",
        )
        .replace(
            "\"root_unit_id\" is a required property",
            "missing required field: root_unit_id",
        )
        .replace(
            "\"text\" is a required property",
            "missing required field: text",
        )
        .replace(
            "\"clean_text\" is a required property",
            "missing required field: clean_text",
        )
        .replace(
            "\"metadata\" is a required property",
            "missing required field: metadata",
        )
        .replace(
            "\"anchor\" is a required property",
            "missing required field: anchor",
        )
        .replace(
            "\"schema_version\" is a required property",
            "missing required field: schema_version",
        )
        .replace(
            "\"release_id\" is a required property",
            "missing required field: release_id",
        )
        .replace(
            "\"corpus\" is a required property",
            "missing required field: corpus",
        )
        .replace(
            "\"collection\" is a required property",
            "missing required field: collection",
        )
        .replace(
            "\"artifacts\" is a required property",
            "missing required field: artifacts",
        )
}

fn document_unit_schema() -> Value {
    serde_json::from_str(CANONICAL_DOCUMENT_UNIT_SCHEMA_JSON)
        .expect("canonical document unit schema must be valid JSON")
}

fn release_manifest_schema() -> Value {
    serde_json::from_str(INGESTION_RELEASE_MANIFEST_SCHEMA_JSON)
        .expect("ingestion release manifest schema must be valid JSON")
}

#[cfg(test)]
mod tests {
    use super::{
        ChunkDocumentUnitsOptions, chunk_document_units_jsonl, count_tokens_from_tokenizer_json,
        validate_document_units_jsonl, validate_release_manifest_json,
    };
    use std::fs;
    use std::path::Path;

    #[test]
    fn validates_document_units_jsonl_and_reports_missing_required_fields() {
        let report = validate_document_units_jsonl(
            r#"{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"hello","clean_text":"hello","metadata":{},"anchor":{}}
{"doc_id":"doc1","version_id":"v1","root_unit_id":"u2","text":"missing id","clean_text":"missing id","metadata":{},"anchor":{}}
"#,
        );

        assert_eq!(report.schema_version, "document_units_validation_report.v1");
        assert_eq!(report.unit_count, 2);
        assert_eq!(report.error_count, 1);
        assert_eq!(
            report.errors,
            vec!["line 2 missing required field: chunk_id"]
        );
    }

    #[test]
    fn chunks_document_units_jsonl_into_traceable_chunk_set() {
        let chunk_set = chunk_document_units_jsonl(
            r#"{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"第一段内容","clean_text":"第一段内容","metadata":{"heading":"总则"},"anchor":{}}
{"doc_id":"doc1","version_id":"v1","chunk_id":"u2","root_unit_id":"u2","text":"第二段内容","clean_text":"第二段内容","metadata":{"heading":"细则"},"anchor":{}}
"#,
            ChunkDocumentUnitsOptions {
                chunk_size: 4,
                max_tokens: 4,
                min_tokens: 1,
                overlap: 0,
                tokenizer_json_path: test_tokenizer_json_path(),
            },
        )
        .unwrap();

        assert_eq!(chunk_set.schema_version, "ingestion_chunk_set.v1");
        assert_eq!(chunk_set.chunk_count, 2);
        assert_eq!(chunk_set.chunks[0].chunk_id, "doc1::chunk::000001");
        assert_eq!(chunk_set.chunks[0].doc_id, "doc1");
        assert_eq!(chunk_set.chunks[0].unit_ids, vec!["u1"]);
        assert_eq!(chunk_set.error_count, 0);
    }

    #[test]
    fn chunks_merge_adjacent_short_units_until_min_tokens_without_crossing_documents() {
        let chunk_set = chunk_document_units_jsonl(
            r#"{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"hello","clean_text":"hello","metadata":{},"anchor":{}}
{"doc_id":"doc1","version_id":"v1","chunk_id":"u2","root_unit_id":"u2","text":"world","clean_text":"world","metadata":{},"anchor":{}}
{"doc_id":"doc2","version_id":"v1","chunk_id":"u3","root_unit_id":"u3","text":"alpha","clean_text":"alpha","metadata":{},"anchor":{}}
"#,
            ChunkDocumentUnitsOptions {
                chunk_size: 4,
                max_tokens: 4,
                min_tokens: 2,
                overlap: 0,
                tokenizer_json_path: test_tokenizer_json_path(),
            },
        )
        .unwrap();

        assert_eq!(chunk_set.chunk_count, 2);
        assert_eq!(chunk_set.chunks[0].doc_id, "doc1");
        assert_eq!(chunk_set.chunks[0].unit_ids, vec!["u1", "u2"]);
        assert_eq!(chunk_set.chunks[0].text, "hello\nworld");
        assert_eq!(chunk_set.chunks[1].doc_id, "doc2");
        assert_eq!(chunk_set.chunks[1].unit_ids, vec!["u3"]);
    }

    #[test]
    fn chunk_ids_are_numbered_within_each_document() {
        let chunk_set = chunk_document_units_jsonl(
            r#"{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"hello","clean_text":"hello","metadata":{},"anchor":{}}
{"doc_id":"doc1","version_id":"v1","chunk_id":"u2","root_unit_id":"u2","text":"world","clean_text":"world","metadata":{},"anchor":{}}
{"doc_id":"doc2","version_id":"v1","chunk_id":"u3","root_unit_id":"u3","text":"alpha","clean_text":"alpha","metadata":{},"anchor":{}}
{"doc_id":"doc2","version_id":"v1","chunk_id":"u4","root_unit_id":"u4","text":"beta","clean_text":"beta","metadata":{},"anchor":{}}
"#,
            ChunkDocumentUnitsOptions {
                chunk_size: 4,
                max_tokens: 4,
                min_tokens: 1,
                overlap: 0,
                tokenizer_json_path: test_tokenizer_json_path(),
            },
        )
        .unwrap();

        let chunk_ids: Vec<&str> = chunk_set
            .chunks
            .iter()
            .map(|chunk| chunk.chunk_id.as_str())
            .collect();

        assert_eq!(
            chunk_ids,
            vec![
                "doc1::chunk::000001",
                "doc1::chunk::000002",
                "doc2::chunk::000001",
                "doc2::chunk::000002"
            ]
        );
    }

    #[test]
    fn release_manifest_validation_reports_missing_required_fields() {
        let report = validate_release_manifest_json(
            r#"{
  "schema_version": "ingestion_release_manifest.v2",
  "release_id": "student-rules-release-001",
  "collection": "student_rules",
  "artifacts": [
    {"kind": "chunks", "uri": "s3://bucket/chunks.jsonl", "digest": "sha256:abc", "byte_size": 1}
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
    fn release_manifest_validation_rejects_invalid_digests_and_duplicate_uris() {
        let report = validate_release_manifest_json(
            r#"{
  "schema_version": "ingestion_release_manifest.v2",
  "release_id": "release-001",
  "corpus": "official_web",
  "collection": "stable_reference",
  "artifacts": [
    {"kind": "chunks", "uri": "s3://bucket/chunks.json", "digest": "sha256:abc", "byte_size": 1},
    {"kind": "chunks-copy", "uri": "s3://bucket/chunks.json", "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000", "byte_size": 1}
  ]
}"#,
        );

        assert_eq!(report.error_count, 2);
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("artifacts[0] digest must be sha256 lowercase hex"))
        );
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("duplicate artifact uri: s3://bucket/chunks.json"))
        );
    }

    #[test]
    fn counts_tokens_with_local_tokenizer_json_without_special_tokens() {
        let temp_dir =
            std::env::temp_dir().join(format!("campus-tokenizer-test-{}", std::process::id()));
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

    fn test_tokenizer_json_path() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/tokenizer.json")
    }
}
