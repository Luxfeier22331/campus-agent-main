package com.campusagent.legacyoffice;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jodconverter.core.DocumentConverter;
import org.jodconverter.core.document.DefaultDocumentFormatRegistry;
import org.jodconverter.core.document.DocumentFormat;
import org.jodconverter.core.office.OfficeException;
import org.jodconverter.local.LocalConverter;
import org.jodconverter.local.office.LocalOfficeManager;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class LegacyOfficeConversionService {

  private static final Map<String, String> TARGET_MEDIA_TYPES =
      Map.of(
          "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  private final Path workingDir;
  private final String officeHome;
  private final long taskTimeoutMs;
  private final long queueTimeoutMs;
  private final int maxTasksPerProcess;
  private final AtomicBoolean ready = new AtomicBoolean(false);

  private volatile LocalOfficeManager officeManager;
  private volatile String lastFailureReason;
  private volatile String engineVersion = "unknown";

  public LegacyOfficeConversionService(
      @Value("${LIBREOFFICE_SERVICE_WORKDIR:/tmp/legacy-office-conversion}") final String workingDir,
      @Value("${LIBREOFFICE_HOME:}") final String officeHome,
      @Value("${LIBREOFFICE_SERVICE_TASK_TIMEOUT_MS:120000}") final long taskTimeoutMs,
      @Value("${LIBREOFFICE_SERVICE_QUEUE_TIMEOUT_MS:150000}") final long queueTimeoutMs,
      @Value("${LIBREOFFICE_SERVICE_MAX_TASKS_PER_PROCESS:200}") final int maxTasksPerProcess) {
    this.workingDir = Path.of(workingDir);
    this.officeHome = officeHome == null ? "" : officeHome.trim();
    this.taskTimeoutMs = taskTimeoutMs;
    this.queueTimeoutMs = queueTimeoutMs;
    this.maxTasksPerProcess = maxTasksPerProcess;
    initializeOfficeManager();
  }

  public ConversionResult convert(final ConversionCommand command) {
    if (!isReady()) {
      throw new ConversionUnavailableException(
          lastFailureReason == null ? "conversion runtime is not ready" : lastFailureReason);
    }
    validateCommand(command);

    final var decodedBytes = decodeSourceBytes(command.sourceBytesB64());
    final var actualSourceSha = sha256Hex(decodedBytes);
    if (!actualSourceSha.equals(command.sourceSha256())) {
      throw new ConversionBadRequestException(
          "source_sha256 mismatch: expected %s but got %s".formatted(command.sourceSha256(), actualSourceSha));
    }

    final var sourceFormat = resolveSourceFormat(command.filename(), command.sourceMediaType());
    final var targetFormat = resolveTargetFormat(command.targetFormat());

    try (final var inputStream = new ByteArrayInputStream(decodedBytes);
        final var outputStream = new ByteArrayOutputStream()) {
      final DocumentConverter converter = LocalConverter.builder().officeManager(officeManager).build();
      converter.convert(inputStream).as(sourceFormat).to(outputStream).as(targetFormat).execute();
      final var normalizedBytes = outputStream.toByteArray();
      return new ConversionResult(
          command.targetFormat(),
          TARGET_MEDIA_TYPES.get(command.targetFormat()),
          sha256Hex(normalizedBytes),
          normalizedBytes,
          "jodconverter+libreoffice",
          engineVersion,
          List.of());
    } catch (final OfficeException | IOException ex) {
      throw new DeterministicConversionFailureException("legacy Office conversion failed: " + ex.getMessage(), ex);
    }
  }

  public boolean isHealthy() {
    return Files.isDirectory(workingDir);
  }

  public boolean isReady() {
    return ready.get() && Files.isDirectory(workingDir) && Files.isWritable(workingDir);
  }

  public String getLastFailureReason() {
    return lastFailureReason;
  }

  public String getEngineVersion() {
    return engineVersion;
  }

  void setReadyForTest(final boolean ready) {
    this.ready.set(ready);
  }

  void setLastFailureReasonForTest(final String reason) {
    this.lastFailureReason = reason;
  }

  void setEngineVersionForTest(final String version) {
    this.engineVersion = version;
  }

  private void initializeOfficeManager() {
    try {
      Files.createDirectories(workingDir);
      this.engineVersion = detectLibreOfficeVersion();
      final var builder =
          LocalOfficeManager.builder()
              .workingDir(workingDir.toFile())
              .taskExecutionTimeout(taskTimeoutMs)
              .taskQueueTimeout(queueTimeoutMs)
              .maxTasksPerProcess(maxTasksPerProcess)
              .startFailFast(true);
      if (!officeHome.isEmpty()) {
        builder.officeHome(officeHome);
      }
      officeManager = builder.build();
      officeManager.start();
      ready.set(true);
      lastFailureReason = null;
    } catch (final Exception ex) {
      ready.set(false);
      lastFailureReason = ex.getMessage();
    }
  }

  private void validateCommand(final ConversionCommand command) {
    if (!TARGET_MEDIA_TYPES.containsKey(command.targetFormat())) {
      throw new ConversionBadRequestException("unsupported target_format: " + command.targetFormat());
    }
  }

  private DocumentFormat resolveSourceFormat(final String filename, final String sourceMediaType) {
    final var lowerFilename = filename.toLowerCase();
    if (lowerFilename.endsWith(".doc") || "application/msword".equals(sourceMediaType)) {
      return DefaultDocumentFormatRegistry.DOC;
    }
    if (lowerFilename.endsWith(".xls") || "application/vnd.ms-excel".equals(sourceMediaType)) {
      return DefaultDocumentFormatRegistry.XLS;
    }
    throw new ConversionBadRequestException("unsupported legacy Office source: " + filename);
  }

  private DocumentFormat resolveTargetFormat(final String targetFormat) {
    return switch (targetFormat) {
      case "docx" -> DefaultDocumentFormatRegistry.DOCX;
      case "xlsx" -> DefaultDocumentFormatRegistry.XLSX;
      default -> throw new ConversionBadRequestException("unsupported target_format: " + targetFormat);
    };
  }

  private byte[] decodeSourceBytes(final String sourceBytesB64) {
    try {
      return Base64.getDecoder().decode(sourceBytesB64);
    } catch (final IllegalArgumentException ex) {
      throw new ConversionBadRequestException("source_bytes_b64 is invalid", ex);
    }
  }

  private String detectLibreOfficeVersion() {
    try {
      final var executable =
          officeHome.isEmpty() ? Path.of("soffice") : Path.of(officeHome, "program", "soffice");
      final var process = new ProcessBuilder(executable.toString(), "--version").start();
      final var stdout = new String(process.getInputStream().readAllBytes()).trim();
      final var stderr = new String(process.getErrorStream().readAllBytes()).trim();
      final var exitCode = process.waitFor();
      if (exitCode != 0) {
        return "unknown";
      }
      final var version = !stdout.isEmpty() ? stdout : stderr;
      return version.isEmpty() ? "unknown" : version;
    } catch (final Exception ex) {
      return "unknown";
    }
  }

  private static String sha256Hex(final byte[] payload) {
    try {
      return HexFormat.format(MessageDigest.getInstance("SHA-256").digest(payload));
    } catch (final NoSuchAlgorithmException ex) {
      throw new IllegalStateException("SHA-256 is unavailable", ex);
    }
  }

  static final class HexFormat {
    static String format(final byte[] digest) {
      final var builder = new StringBuilder(digest.length * 2);
      for (final byte current : digest) {
        builder.append(String.format("%02x", current));
      }
      return builder.toString();
    }
  }

  public record ConversionCommand(
      String sourceMediaType,
      String targetFormat,
      String sourceSha256,
      String filename,
      String sourceBytesB64) {}

  public record ConversionResult(
      String targetFormat,
      String normalizedMediaType,
      String normalizedSha256,
      byte[] normalizedBytes,
      String engineName,
      String engineVersion,
      List<String> warnings) {}

  public static class ConversionBadRequestException extends RuntimeException {
    public ConversionBadRequestException(final String message) {
      super(message);
    }

    public ConversionBadRequestException(final String message, final Throwable cause) {
      super(message, cause);
    }
  }

  public static class ConversionUnavailableException extends RuntimeException {
    public ConversionUnavailableException(final String message) {
      super(message);
    }
  }

  public static class DeterministicConversionFailureException extends RuntimeException {
    public DeterministicConversionFailureException(final String message, final Throwable cause) {
      super(message, cause);
    }
  }
}
