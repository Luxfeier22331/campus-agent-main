package com.campusagent.legacyoffice;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/internal/legacy-office")
@Validated
public class LegacyOfficeConversionController {

  private final LegacyOfficeConversionService conversionService;

  public LegacyOfficeConversionController(final LegacyOfficeConversionService conversionService) {
    this.conversionService = conversionService;
  }

  @PostMapping("/conversions")
  public ResponseEntity<?> convert(@Valid @RequestBody final ConversionRequestPayload payload) {
    try {
      final var result =
          conversionService.convert(
              new LegacyOfficeConversionService.ConversionCommand(
                  payload.sourceMediaType(),
                  payload.targetFormat(),
                  payload.sourceSha256(),
                  payload.filename(),
                  payload.sourceBytesB64()));
      return ResponseEntity.ok(
          new ConversionResponsePayload(
              result.targetFormat(),
              result.normalizedMediaType(),
              result.normalizedSha256(),
              Base64.getEncoder().encodeToString(result.normalizedBytes()),
              result.engineName(),
              result.engineVersion(),
              result.warnings()));
    } catch (final LegacyOfficeConversionService.ConversionBadRequestException ex) {
      return buildError(HttpStatus.BAD_REQUEST, "invalid_request", ex.getMessage(), false);
    } catch (final LegacyOfficeConversionService.ConversionUnavailableException ex) {
      return buildError(HttpStatus.SERVICE_UNAVAILABLE, "runtime_unavailable", ex.getMessage(), true);
    } catch (final LegacyOfficeConversionService.DeterministicConversionFailureException ex) {
      return buildError(HttpStatus.UNPROCESSABLE_ENTITY, "conversion_failed", ex.getMessage(), false);
    }
  }

  private ResponseEntity<Map<String, Object>> buildError(
      final HttpStatus status,
      final String errorCode,
      final String message,
      final boolean retryable) {
    final var payload = new LinkedHashMap<String, Object>();
    payload.put("error_code", errorCode);
    payload.put("message", message);
    payload.put("retryable", retryable);
    return ResponseEntity.status(status).body(payload);
  }

  public record ConversionRequestPayload(
      @JsonProperty("source_media_type")
      @NotBlank(message = "source_media_type is required")
      String sourceMediaType,
      @JsonProperty("target_format")
      @NotBlank(message = "target_format is required")
      String targetFormat,
      @JsonProperty("source_sha256")
      @NotBlank(message = "source_sha256 is required")
      String sourceSha256,
      @NotBlank(message = "filename is required") String filename,
      @JsonProperty("source_bytes_b64")
      @NotBlank(message = "source_bytes_b64 is required")
      String sourceBytesB64) {}

  public record ConversionResponsePayload(
      String target_format,
      String normalized_media_type,
      String normalized_sha256,
      String normalized_bytes_b64,
      String engine_name,
      String engine_version,
      List<String> warnings) {}
}
