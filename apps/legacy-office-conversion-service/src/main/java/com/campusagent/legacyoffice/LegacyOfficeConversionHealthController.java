package com.campusagent.legacyoffice;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LegacyOfficeConversionHealthController {

  private final LegacyOfficeConversionService conversionService;

  public LegacyOfficeConversionHealthController(
      final LegacyOfficeConversionService conversionService) {
    this.conversionService = conversionService;
  }

  @GetMapping("/healthz")
  public Map<String, Object> healthz() {
    final var payload = new LinkedHashMap<String, Object>();
    payload.put("status", conversionService.isHealthy() ? "ok" : "degraded");
    payload.put("engine_name", "jodconverter+libreoffice");
    payload.put("engine_version", conversionService.getEngineVersion());
    if (conversionService.getLastFailureReason() != null) {
      payload.put("last_failure_reason", conversionService.getLastFailureReason());
    }
    return payload;
  }

  @GetMapping("/readyz")
  public ResponseEntity<Map<String, Object>> readyz() {
    final var payload = new LinkedHashMap<String, Object>();
    payload.put("engine_name", "jodconverter+libreoffice");
    payload.put("engine_version", conversionService.getEngineVersion());
    if (conversionService.isReady()) {
      payload.put("status", "ready");
      return ResponseEntity.ok(payload);
    }
    payload.put("status", "not_ready");
    if (conversionService.getLastFailureReason() != null) {
      payload.put("last_failure_reason", conversionService.getLastFailureReason());
    }
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(payload);
  }
}
