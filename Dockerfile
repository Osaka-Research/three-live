FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN ARCH="$(uname -m)" && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
      BIN="three-live-cli-linux-aarch64"; \
    else \
      BIN="three-live-cli-linux-x86_64"; \
    fi && \
    (curl -fsSL "https://github.com/google/three-live/releases/download/v1.3.2/${BIN}" -o /usr/local/bin/three-live-cli || \
     curl -fsSL "https://github.com/google/three-live/releases/latest/download/${BIN}" -o /usr/local/bin/three-live-cli) && \
    chmod +x /usr/local/bin/three-live-cli
ENTRYPOINT ["/usr/local/bin/three-live-cli", "mcp"]
