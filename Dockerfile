# Multi-stage build: Node.js + Python for pipeline execution
FROM node:20-slim AS base

# Install Python 3 and venv support
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment
RUN python3 -m venv /opt/pipeline-venv
ENV PYTHON_PATH=/opt/pipeline-venv/bin/python3

# Install Python dependencies
COPY pipeline/requirements.txt /tmp/requirements.txt
RUN /opt/pipeline-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# Set working directory
WORKDIR /app

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source
COPY . .

# Build Next.js
RUN npm run build

# Copy static pipeline files into a known location inside the image
# These are shared across all problems and don't change per-run
RUN mkdir -p /app/pipeline-static && \
    cp -r pipeline/Scripts /app/pipeline-static/Scripts && \
    cp -r pipeline/Inputs /app/pipeline-static/Inputs && \
    cp -r pipeline/zReferenceFiles /app/pipeline-static/zReferenceFiles && \
    cp -f pipeline/pricing.json /app/pipeline-static/pricing.json 2>/dev/null || true

# Environment variables for pipeline paths
ENV PIPELINE_SCRIPTS_DIR=/app/pipeline-static/Scripts
ENV PIPELINE_SHARED_INPUTS_DIR=/app/pipeline-static/Inputs
ENV PIPELINE_REFERENCE_DIR=/app/pipeline-static/zReferenceFiles
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
