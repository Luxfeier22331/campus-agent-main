ARG HINDSIGHT_API_BASE_IMAGE=ghcr.io/vectorize-io/hindsight-api:0.8.2
FROM ${HINDSIGHT_API_BASE_IMAGE}

COPY infra/local/hindsight-api-openai-default-headers/patch-openai-default-headers.py /tmp/patch-openai-default-headers.py
RUN python /tmp/patch-openai-default-headers.py
