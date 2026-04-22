package com.campusagent.legacyoffice;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class LegacyOfficeConversionControllerTest {

  private LegacyOfficeConversionService conversionService;
  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    conversionService = mock(LegacyOfficeConversionService.class);
    mockMvc =
        MockMvcBuilders.standaloneSetup(new LegacyOfficeConversionController(conversionService))
            .addFilters(new InternalSharedSecretFilter("test-secret"))
            .build();
  }

  @Test
  void rejectsMissingInternalSharedSecret() throws Exception {
    mockMvc
        .perform(
            post("/api/internal/legacy-office/conversions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void rejectsWrongInternalSharedSecret() throws Exception {
    mockMvc
        .perform(
            post("/api/internal/legacy-office/conversions")
                .header("x-app-internal-auth", "wrong-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void returnsSuccessfulConversionPayload() throws Exception {
    when(conversionService.convert(any()))
        .thenReturn(
            new LegacyOfficeConversionService.ConversionResult(
                "docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "hash-123",
                "normalized-docx".getBytes(),
                "jodconverter+libreoffice",
                "7.6.7",
                List.of()));

    mockMvc
        .perform(
            post("/api/internal/legacy-office/conversions")
                .header("x-app-internal-auth", "test-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "source_media_type": "application/msword",
                      "target_format": "docx",
                      "source_sha256": "abc123",
                      "filename": "legacy.doc",
                      "source_bytes_b64": "bGVnYWN5LWRvYw=="
                    }
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.target_format").value("docx"))
        .andExpect(jsonPath("$.engine_name").value("jodconverter+libreoffice"))
        .andExpect(jsonPath("$.normalized_sha256").value("hash-123"));
  }

  @Test
  void mapsBadRequestFailures() throws Exception {
    when(conversionService.convert(any()))
        .thenThrow(
            new LegacyOfficeConversionService.ConversionBadRequestException(
                "unsupported target_format"));

    mockMvc
        .perform(
            post("/api/internal/legacy-office/conversions")
                .header("x-app-internal-auth", "test-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "source_media_type": "application/msword",
                      "target_format": "pdf",
                      "source_sha256": "abc123",
                      "filename": "legacy.doc",
                      "source_bytes_b64": "bGVnYWN5LWRvYw=="
                    }
                    """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error_code").value("invalid_request"));
  }
}
