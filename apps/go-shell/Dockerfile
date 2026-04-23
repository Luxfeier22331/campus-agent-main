FROM golang:1.26.2-bookworm AS build

WORKDIR /src/apps/go-shell

COPY apps/go-shell/go.mod ./
COPY apps/go-shell ./

RUN go test ./... \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/go-shell ./cmd/go-shell

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY --from=build /out/go-shell /usr/local/bin/go-shell

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0

ENTRYPOINT ["/usr/local/bin/go-shell"]
