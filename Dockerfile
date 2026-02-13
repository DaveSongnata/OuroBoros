# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

# ── Stage 2: Build backend ──────────────────────────────────────────────────
FROM golang:1.24-alpine AS backend
RUN apk add --no-cache gcc musl-dev
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 go build -o /api ./cmd/api

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM alpine:3.21
RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=backend /api ./api
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV PORT=10000
ENV STATIC_DIR=./frontend/dist
ENV DATA_DIR=/data

EXPOSE 10000
CMD ["./api"]
