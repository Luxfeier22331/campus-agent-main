FROM golang:1.26.2-bookworm AS build

ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org

ENV GOPROXY=${GOPROXY} \
  GOSUMDB=${GOSUMDB}

WORKDIR /src/apps/supervisor-api

COPY apps/supervisor-api/go.mod apps/supervisor-api/go.sum ./
RUN go mod download

COPY apps/supervisor-api ./

RUN go test ./... \
  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/supervisor-api ./cmd/supervisor-api

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY --from=build /out/supervisor-api /usr/local/bin/supervisor-api

USER appuser
EXPOSE 8000
ENV CAMPUS_AGENT_HTTP_HOST=0.0.0.0

ENTRYPOINT ["/usr/local/bin/supervisor-api"]
