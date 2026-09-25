# Node.js + Python in one image: the Next.js server spawns the Python CP-prep
# pipeline as a detached child (src/app/api/pipeline/run/start-step.ts) and
# tracks its PID in memory (src/lib/process-registry.ts). Splitting them into
# two services would break both the spawn and the cancel button.

FROM node:20-bookworm-slim AS base

# python3 (3.11 on bookworm) for the pipeline; ca-certificates for TLS to
# OpenRouter / S3 / Postgres.
#
# Deliberately NO g++ / javac / jdk: C++, Java and Node.js submissions are
# executed by the remote compiler service (NEW_COMPILER_URL), not locally. The
# only local subprocesses are Python (benchmark_suite.py and
# testcase_manager_v4.py both shell out to `_python_executable()`).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Debian's Python is PEP 668 "externally managed", so pip refuses to install
# into it. The venv is also what gives PYTHON_PATH a stable absolute location.
RUN python3 -m venv /opt/pipeline-venv
ENV PYTHON_PATH=/opt/pipeline-venv/bin/python3

# The root requirements.txt is the full transitive lock of the loose spec in
# pipeline/requirements.txt — prefer it so image builds are reproducible.
# Copied alone so a code-only change reuses this layer.
COPY requirements.txt /tmp/requirements.txt
RUN /opt/pipeline-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app

# Before NODE_ENV=production is set, so devDependencies (typescript, tailwind,
# the eslint config) are installed — the Next build needs them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# src/lib/db/index.ts throws at import time when DATABASE_URL is unset, and the
# Next build imports it while collecting page data. postgres-js connects
# lazily and every route is dynamic, so a syntactically valid dummy satisfies
# the build without touching a real database. The real value is injected at
# runtime by the host's env.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run build

# Pristine copies of the read-only pipeline inputs. Per-run workspaces are
# built by copying out of these, so the originals never get mutated by a run.
RUN mkdir -p /app/pipeline-static && \
    cp -r pipeline/Scripts /app/pipeline-static/Scripts && \
    cp -r pipeline/Inputs /app/pipeline-static/Inputs && \
    cp -r pipeline/zReferenceFiles /app/pipeline-static/zReferenceFiles

ENV PIPELINE_SCRIPTS_DIR=/app/pipeline-static/Scripts
ENV PIPELINE_SHARED_INPUTS_DIR=/app/pipeline-static/Inputs
ENV PIPELINE_REFERENCE_DIR=/app/pipeline-static/zReferenceFiles
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PYTHONUNBUFFERED=1

# Render injects its own PORT; `npm start` honours it and falls back to 5001.
EXPOSE 5001

CMD ["npm", "start"]
