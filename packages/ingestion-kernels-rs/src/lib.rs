use jsonschema::Validator;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fmt::Write;
use std::path::{Path, PathBuf};
use text_splitter::{ChunkCapacity, ChunkConfig, TextSplitter};
use tokenizers::Tokenizer;

const CANONICAL_DOCUMENT_UNIT_SCHEMA_JSON: &str =
    include_str!("../../ingestion-contracts/schemas/canonical-document-units.v1.schema.json");
const CANONICAL_DOCUMENT_UNIT_V2_SCHEMA_JSON: &str =
    include_str!("../../ingestion-contracts/schemas/canonical-document-units.v2.schema.json");
const RETRIEVAL_CHUNK_V2_SCHEMA_JSON: &str =
    include_str!("../../ingestion-contracts/schemas/retrieval-chunks.v2.schema.json");

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentUnitsValidationReport {
    pub schema_version: String,
    pub unit_count: usize,
    pub error_count: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetrievalChunkSetV2 {
    pub schema_version: String,
    pub chunk_count: usize,
    pub chunks: Vec<RetrievalChunkV2>,
    pub error_count: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetrievalChunkV2 {
    pub schema_version: String,
    pub document_scope: String,
    pub document_id: String,
    pub version_id: String,
    pub section_id: String,
    pub chunk_id: String,
    pub ordinal: usize,
    pub token_count: usize,
    pub text: String,
    pub text_sha256: String,
    pub metadata: serde_json::Map<String, Value>,
}

pub struct BuildRetrievalChunksV2Options {
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

pub fn build_retrieval_chunks_v2_jsonl(
    input: &str,
    options: BuildRetrievalChunksV2Options,
) -> Result<RetrievalChunkSetV2, Box<dyn Error + Send + Sync>> {
    validate_chunk_options(&options)?;
    let mut tokenizer = Tokenizer::from_file(&options.tokenizer_json_path)?;
    tokenizer.with_truncation(None)?;
    tokenizer.with_padding(None);

    let mut errors = Vec::new();
    let mut chunks = Vec::new();
    let validator = validator_for_schema(canonical_document_unit_v2_schema())
        .expect("embedded canonical document unit v2 schema must compile");
    let chunk_validator = validator_for_schema(retrieval_chunk_v2_schema())
        .expect("embedded retrieval chunk v2 schema must compile");
    let splitter = TextSplitter::new(
        ChunkConfig::new(
            ChunkCapacity::new(options.chunk_size)
                .with_max(options.max_tokens)
                .expect("chunk options validate max_tokens"),
        )
        .with_sizer(tokenizer.clone())
        .with_overlap(options.overlap)?,
    );
    let mut sections = Vec::new();

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
        let section: CanonicalDocumentUnitV2 = match serde_json::from_value(parsed) {
            Ok(section) => section,
            Err(error) => {
                errors.push(format!(
                    "line {line_number} cannot be represented by the kernel: {error}"
                ));
                continue;
            }
        };
        if sha256_ref(&section.content) != section.content_sha256 {
            errors.push(format!(
                "line {line_number} content_sha256 does not match content"
            ));
            continue;
        }
        sections.push(ParsedSection {
            line_number,
            section,
        });
    }

    sections.sort_by(|left, right| {
        section_sort_key(&left.section).cmp(&section_sort_key(&right.section))
    });
    for pair in sections.windows(2) {
        if section_identity(&pair[0].section) == section_identity(&pair[1].section) {
            errors.push(format!(
                "line {} duplicates document_id/version_id/section_id from line {}",
                pair[1].line_number, pair[0].line_number
            ));
        }
    }

    if errors.is_empty() {
        for parsed in sections {
            let spans = section_chunk_spans(
                &splitter,
                &tokenizer,
                &parsed.section.content,
                options.min_tokens,
                options.max_tokens,
            )?;
            if spans.is_empty() {
                errors.push(format!(
                    "line {} content produced no retrieval chunks",
                    parsed.line_number
                ));
                continue;
            }
            for (ordinal, span) in spans.into_iter().enumerate() {
                let text = parsed.section.content[span.start..span.end].to_string();
                let count = token_count(&tokenizer, &text)?;
                if count == 0 || count > options.max_tokens {
                    errors.push(format!(
                        "line {} chunk {ordinal} has invalid token_count {count}",
                        parsed.line_number
                    ));
                    continue;
                }
                let chunk = retrieval_chunk(&parsed.section, ordinal, count, text);
                let value = serde_json::to_value(&chunk)?;
                let schema_errors = validation_errors(&chunk_validator, &value, None);
                if schema_errors.is_empty() {
                    chunks.push(chunk);
                } else {
                    errors.extend(schema_errors.into_iter().map(|error| {
                        format!("line {} chunk {ordinal} {error}", parsed.line_number)
                    }));
                }
            }
        }
    }

    Ok(RetrievalChunkSetV2 {
        schema_version: "retrieval_chunk_set.v2".to_string(),
        chunk_count: chunks.len(),
        chunks,
        error_count: errors.len(),
        errors,
    })
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

#[derive(Debug, Deserialize)]
struct CanonicalDocumentUnitV2 {
    document_scope: String,
    document_id: String,
    version_id: String,
    section_id: String,
    ordinal: usize,
    content: String,
    content_sha256: String,
}

struct ParsedSection {
    line_number: usize,
    section: CanonicalDocumentUnitV2,
}

#[derive(Clone, Copy)]
struct ChunkSpan {
    start: usize,
    end: usize,
}

fn section_chunk_spans(
    splitter: &TextSplitter<Tokenizer>,
    tokenizer: &Tokenizer,
    text: &str,
    min_tokens: usize,
    max_tokens: usize,
) -> Result<Vec<ChunkSpan>, Box<dyn Error + Send + Sync>> {
    let mut spans = splitter
        .chunk_indices(text)
        .map(|(start, chunk)| ChunkSpan {
            start,
            end: start + chunk.len(),
        })
        .collect::<Vec<_>>();
    if spans.len() > 1 {
        let last = *spans.last().expect("span length checked");
        let last_count = token_count(tokenizer, &text[last.start..last.end])?;
        if last_count < min_tokens {
            let previous = spans[spans.len() - 2];
            let merged_count = token_count(tokenizer, &text[previous.start..last.end])?;
            if merged_count <= max_tokens {
                spans.pop();
                spans.last_mut().expect("previous span exists").end = last.end;
            }
        }
    }
    Ok(spans)
}

fn retrieval_chunk(
    section: &CanonicalDocumentUnitV2,
    ordinal: usize,
    token_count: usize,
    text: String,
) -> RetrievalChunkV2 {
    let text_sha256 = sha256_ref(&text);
    let identity = format!(
        "{}\0{}\0{}\0{}\0{}\0{}",
        section.document_scope,
        section.document_id,
        section.version_id,
        section.section_id,
        ordinal,
        text_sha256
    );
    RetrievalChunkV2 {
        schema_version: "retrieval_chunk.v2".to_string(),
        document_scope: section.document_scope.clone(),
        document_id: section.document_id.clone(),
        version_id: section.version_id.clone(),
        section_id: section.section_id.clone(),
        chunk_id: format!("retrieval:{}", sha256_hex(&identity)),
        ordinal,
        token_count,
        text,
        text_sha256,
        metadata: serde_json::Map::new(),
    }
}

fn section_sort_key(section: &CanonicalDocumentUnitV2) -> (&str, &str, &str, usize, &str) {
    (
        &section.document_scope,
        &section.document_id,
        &section.version_id,
        section.ordinal,
        &section.section_id,
    )
}

fn section_identity(section: &CanonicalDocumentUnitV2) -> (&str, &str, &str, &str) {
    (
        &section.document_scope,
        &section.document_id,
        &section.version_id,
        &section.section_id,
    )
}

fn sha256_ref(value: &str) -> String {
    format!("sha256:{}", sha256_hex(value))
}

fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn validate_chunk_options(
    options: &BuildRetrievalChunksV2Options,
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

fn canonical_document_unit_v2_schema() -> Value {
    serde_json::from_str(CANONICAL_DOCUMENT_UNIT_V2_SCHEMA_JSON)
        .expect("canonical document unit v2 schema must be valid JSON")
}

fn retrieval_chunk_v2_schema() -> Value {
    serde_json::from_str(RETRIEVAL_CHUNK_V2_SCHEMA_JSON)
        .expect("retrieval chunk v2 schema must be valid JSON")
}

#[cfg(test)]
mod tests {
    use super::{
        BuildRetrievalChunksV2Options, build_retrieval_chunks_v2_jsonl,
        count_tokens_from_tokenizer_json, sha256_ref, validate_document_units_jsonl,
    };
    use serde_json::json;
    use std::fs;
    use std::path::Path;

    #[test]
    fn sha256_encoding_matches_the_existing_lowercase_hex_contract() {
        assert_eq!(
            sha256_ref("hello"),
            "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

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
    fn builds_schema_valid_retrieval_chunks_with_exact_token_counts() {
        let input = format!(
            "{}\n",
            section_json("section-b", 1, "hello world alpha beta")
        );
        let chunk_set = build_retrieval_chunks_v2_jsonl(&input, chunk_options()).unwrap();

        assert_eq!(chunk_set.schema_version, "retrieval_chunk_set.v2");
        assert_eq!(chunk_set.chunk_count, 2);
        assert_eq!(chunk_set.chunks[0].schema_version, "retrieval_chunk.v2");
        assert_eq!(chunk_set.chunks[0].document_scope, "regulations");
        assert_eq!(chunk_set.chunks[0].document_id, "doc-1");
        assert_eq!(chunk_set.chunks[0].version_id, "version-1");
        assert_eq!(chunk_set.chunks[0].section_id, "section-b");
        assert_eq!(chunk_set.chunks[0].ordinal, 0);
        assert_eq!(chunk_set.chunks[0].token_count, 2);
        assert_eq!(
            chunk_set.chunks[0].text_sha256,
            sha256_ref(&chunk_set.chunks[0].text)
        );
        assert!(chunk_set.chunks[0].chunk_id.starts_with("retrieval:"));
        assert!(chunk_set.chunks[0].metadata.is_empty());
        assert_eq!(chunk_set.error_count, 0);
    }

    #[test]
    fn never_merges_chunks_across_sections() {
        let input = format!(
            "{}\n{}\n",
            section_json("section-a", 0, "hello"),
            section_json("section-b", 1, "world")
        );
        let mut options = chunk_options();
        options.min_tokens = 2;
        let chunk_set = build_retrieval_chunks_v2_jsonl(&input, options).unwrap();

        assert_eq!(chunk_set.chunk_count, 2);
        assert_eq!(chunk_set.chunks[0].section_id, "section-a");
        assert_eq!(chunk_set.chunks[0].text, "hello");
        assert_eq!(chunk_set.chunks[1].section_id, "section-b");
        assert_eq!(chunk_set.chunks[1].text, "world");
    }

    #[test]
    fn chunk_order_and_ids_are_independent_of_input_line_order() {
        let first = section_json("section-a", 0, "hello world");
        let second = section_json("section-b", 1, "alpha beta");
        let forward =
            build_retrieval_chunks_v2_jsonl(&format!("{first}\n{second}\n"), chunk_options())
                .unwrap();
        let reversed =
            build_retrieval_chunks_v2_jsonl(&format!("{second}\n{first}\n"), chunk_options())
                .unwrap();

        assert_eq!(forward, reversed);
        assert_eq!(forward.chunks[0].section_id, "section-a");
        assert_ne!(forward.chunks[0].chunk_id, forward.chunks[1].chunk_id);
    }

    #[test]
    fn rejects_mismatched_content_digest_without_emitting_partial_chunks() {
        let mut section: serde_json::Value =
            serde_json::from_str(&section_json("section-a", 0, "hello")).unwrap();
        section["content_sha256"] = json!(format!("sha256:{}", "0".repeat(64)));

        let chunk_set =
            build_retrieval_chunks_v2_jsonl(&format!("{section}\n"), chunk_options()).unwrap();

        assert_eq!(chunk_set.chunk_count, 0);
        assert_eq!(chunk_set.error_count, 1);
        assert!(chunk_set.errors[0].contains("content_sha256 does not match"));
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

    fn chunk_options() -> BuildRetrievalChunksV2Options {
        BuildRetrievalChunksV2Options {
            chunk_size: 2,
            max_tokens: 2,
            min_tokens: 1,
            overlap: 0,
            tokenizer_json_path: test_tokenizer_json_path(),
        }
    }

    fn section_json(section_id: &str, ordinal: usize, content: &str) -> String {
        json!({
            "schema_version": "canonical_document_unit.v2",
            "document_scope": "regulations",
            "document_id": "doc-1",
            "version_id": "version-1",
            "section_id": section_id,
            "parent_section_id": null,
            "ordinal": ordinal,
            "anchor": format!("#{section_id}"),
            "document_title": "学生手册",
            "section_title": section_id,
            "canonical_url": format!("https://example.test/handbook#{section_id}"),
            "content": content,
            "content_sha256": sha256_ref(content),
            "metadata": {}
        })
        .to_string()
    }
}
