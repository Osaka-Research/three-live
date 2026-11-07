FROM rust:1.83-slim AS builder
WORKDIR /app
COPY compiler ./compiler
RUN cargo build --release --manifest-path compiler/Cargo.toml --bin three-live-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/compiler/target/release/three-live-cli /usr/local/bin/three-live-cli
ENTRYPOINT ["three-live-cli", "mcp"]
