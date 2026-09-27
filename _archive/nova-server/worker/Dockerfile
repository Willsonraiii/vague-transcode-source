# Vague Nova worker — ffmpeg with x265 + Dolby Vision + HDR10+ tooling
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates xz-utils nodejs npm \
 && rm -rf /var/lib/apt/lists/*

# dovi_tool — Dolby Vision RPU extract / inject / verify
ARG DOVI=2.1.2
RUN curl -fsSL "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI}/dovi_tool-${DOVI}-x86_64-unknown-linux-musl.tar.gz" \
      | tar xz -C /usr/local/bin dovi_tool

# hdr10plus_tool — HDR10+ dynamic metadata
ARG H10P=1.6.1
RUN curl -fsSL "https://github.com/quietvoid/hdr10plus_tool/releases/download/${H10P}/hdr10plus_tool-${H10P}-x86_64-unknown-linux-musl.tar.gz" \
      | tar xz -C /usr/local/bin hdr10plus_tool

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Fail fast at build time if the toolchain is incomplete
RUN ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx265 \
 && dovi_tool --version && hdr10plus_tool --version

CMD ["node", "worker.js"]
