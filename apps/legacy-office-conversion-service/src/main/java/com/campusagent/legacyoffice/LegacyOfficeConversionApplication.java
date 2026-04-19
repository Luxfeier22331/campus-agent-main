package com.campusagent.legacyoffice;

import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class LegacyOfficeConversionApplication {

  public static void main(final String[] args) {
    final var app = new SpringApplication(LegacyOfficeConversionApplication.class);
    app.setDefaultProperties(resolveBindProperties());
    app.run(args);
  }

  private static Map<String, Object> resolveBindProperties() {
    final var bind = System.getenv().getOrDefault("LIBREOFFICE_SERVICE_BIND", "0.0.0.0:8091").trim();
    final var separator = bind.lastIndexOf(':');
    final var properties = new HashMap<String, Object>();
    if (separator > 0 && separator < bind.length() - 1) {
      properties.put("server.address", bind.substring(0, separator));
      properties.put("server.port", Integer.parseInt(bind.substring(separator + 1)));
    } else {
      properties.put("server.address", "0.0.0.0");
      properties.put("server.port", 8091);
    }
    return properties;
  }
}
