package com.campusagent.legacyoffice;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class InternalSharedSecretFilter extends OncePerRequestFilter {

  private final String expectedSecret;

  public InternalSharedSecretFilter(
      @Value("${LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET:}") final String expectedSecret) {
    this.expectedSecret = expectedSecret.trim();
  }

  @Override
  protected boolean shouldNotFilter(final HttpServletRequest request) {
    final var path = request.getRequestURI();
    return "/healthz".equals(path) || "/readyz".equals(path);
  }

  @Override
  protected void doFilterInternal(
      final HttpServletRequest request,
      final HttpServletResponse response,
      final FilterChain filterChain)
      throws ServletException, IOException {
    if (expectedSecret.isEmpty()) {
      response.sendError(
          HttpServletResponse.SC_SERVICE_UNAVAILABLE, "internal shared secret is not configured");
      return;
    }
    final var provided = request.getHeader("x-app-internal-auth");
    if (provided == null || provided.isBlank()) {
      response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "missing x-app-internal-auth");
      return;
    }
    if (!expectedSecret.equals(provided.trim())) {
      response.sendError(HttpServletResponse.SC_FORBIDDEN, "invalid x-app-internal-auth");
      return;
    }
    filterChain.doFilter(request, response);
  }
}
