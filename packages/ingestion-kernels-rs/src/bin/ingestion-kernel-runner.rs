use std::io::{self, Read};
use std::path::PathBuf;

use ingestion_kernels_rs::{
    ChunkDocumentUnitsOptions, chunk_document_units_jsonl, validate_document_units_jsonl,
    validate_release_manifest_json,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let Some(kernel_id) = args.next() else {
        return Err("ingestion kernel id is required".to_string());
    };
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("failed to read stdin: {error}"))?;
    let output = match kernel_id.as_str() {
        "validate-document-units" => serde_json::to_string(&validate_document_units_jsonl(&input)),
        "chunk-document-units" => {
            let options = parse_chunk_options(args)?;
            let chunk_set = chunk_document_units_jsonl(&input, options)
                .map_err(|error| format!("failed to chunk document units: {error}"))?;
            serde_json::to_string(&chunk_set)
        }
        "validate-release-manifest" => {
            serde_json::to_string(&validate_release_manifest_json(&input))
        }
        _ => return Err(format!("unsupported ingestion kernel: {kernel_id}")),
    }
    .map_err(|error| format!("failed to serialize kernel output: {error}"))?;
    println!("{output}");
    Ok(())
}

fn parse_chunk_options(
    mut args: impl Iterator<Item = String>,
) -> Result<ChunkDocumentUnitsOptions, String> {
    let mut tokenizer_json_path: Option<PathBuf> = None;
    let mut chunk_size: Option<usize> = None;
    let mut max_tokens: Option<usize> = None;
    let mut min_tokens: Option<usize> = None;
    let mut overlap: Option<usize> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--tokenizer-json" => {
                tokenizer_json_path = Some(PathBuf::from(required_arg_value(args.next(), &arg)?));
            }
            "--chunk-size" => {
                chunk_size = Some(parse_positive_usize(
                    required_arg_value(args.next(), &arg)?,
                    &arg,
                )?);
            }
            "--max-tokens" => {
                max_tokens = Some(parse_positive_usize(
                    required_arg_value(args.next(), &arg)?,
                    &arg,
                )?);
            }
            "--overlap" => {
                overlap = Some(parse_usize(required_arg_value(args.next(), &arg)?, &arg)?);
            }
            "--min-tokens" => {
                min_tokens = Some(parse_positive_usize(
                    required_arg_value(args.next(), &arg)?,
                    &arg,
                )?);
            }
            "--max-chars" => {
                return Err("--max-chars is retired; --tokenizer-json is required".to_string());
            }
            _ => return Err(format!("unsupported chunk-document-units argument: {arg}")),
        }
    }
    let tokenizer_json_path = tokenizer_json_path.ok_or("--tokenizer-json is required")?;
    if !tokenizer_json_path.is_file() {
        return Err(format!(
            "failed to load tokenizer: {} does not exist",
            tokenizer_json_path.display()
        ));
    }
    Ok(ChunkDocumentUnitsOptions {
        chunk_size: chunk_size.ok_or("--chunk-size is required")?,
        max_tokens: max_tokens.ok_or("--max-tokens is required")?,
        min_tokens: min_tokens.ok_or("--min-tokens is required")?,
        overlap: overlap.ok_or("--overlap is required")?,
        tokenizer_json_path,
    })
}

fn required_arg_value(value: Option<String>, flag: &str) -> Result<String, String> {
    value.ok_or_else(|| format!("{flag} requires a value"))
}

fn parse_positive_usize(value: String, flag: &str) -> Result<usize, String> {
    let parsed = parse_usize(value, flag)?;
    if parsed == 0 {
        return Err(format!("{flag} must be greater than zero"));
    }
    Ok(parsed)
}

fn parse_usize(value: String, flag: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("{flag} must be an integer: {error}"))
}
