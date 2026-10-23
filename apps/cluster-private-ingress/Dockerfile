# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.9-bookworm AS build
ARG TARGETOS=linux
ARG TARGETARCH
WORKDIR /src
COPY apps/cluster-private-ingress/ ./
RUN --mount=type=cache,id=go-build,target=/root/.cache/go-build \
 CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/cluster-private-ingress ./cmd/cluster-private-ingress
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/cluster-private-ingress /usr/local/bin/cluster-private-ingress
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/cluster-private-ingress"]
