# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

# ── Stage 2: Build backend ──────────────────────────────────────────────────
FROM golang:1.25-alpine AS backend
RUN apk add --no-cache gcc musl-dev
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 go build -o /api ./cmd/api

# ── Stage 3: Runtime (Go API + Redis, single container) ─────────────────────
FROM alpine:3.21
RUN apk add --no-cache ca-certificates valkey

WORKDIR /app
COPY --from=backend /api ./api
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Create data directory (replaced by volume mount in production)
RUN mkdir -p /data

ENV PORT=8080
ENV STATIC_DIR=./frontend/dist
ENV DATA_DIR=/data
ENV REDIS_ADDR=localhost:6379

EXPOSE 8080
CMD valkey-server --daemonize yes --save "" --appendonly no && ./api
