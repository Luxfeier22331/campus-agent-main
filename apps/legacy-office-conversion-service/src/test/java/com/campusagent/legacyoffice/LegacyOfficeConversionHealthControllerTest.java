package com.campusagent.legacyoffice;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class LegacyOfficeConversionHealthControllerTest {

  private LegacyOfficeConversionService conversionService;
  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    conversionService = mock(LegacyOfficeConversionService.class);
    mockMvc =
        MockMvcBuilders.standaloneSetup(
                new LegacyOfficeConversionHealthController(conversionService))
            .build();
  }

  @Test
  void healthzReportsProcessLiveness() throws Exception {
    when(conversionService.isHealthy()).thenReturn(true);
    when(conversionService.getEngineVersion()).thenReturn("7.6.7");

    mockMvc
        .perform(get("/healthz"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ok"))
        .andExpect(jsonPath("$.engine_name").value("jodconverter+libreoffice"));
  }

  @Test
  void readyzFailsClosedWhenOfficeManagerIsUnavailable() throws Exception {
    when(conversionService.isReady()).thenReturn(false);
    when(conversionService.getEngineVersion()).thenReturn("unknown");
    when(conversionService.getLastFailureReason()).thenReturn("office manager unavailable");

    mockMvc
        .perform(get("/readyz"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.status").value("not_ready"))
        .andExpect(jsonPath("$.last_failure_reason").value("office manager unavailable"));
  }
}
