.PHONY: dev build run clean docker-up docker-down

# Development: run Go backend directly (requires local Redis)
dev:
	cd backend && go run ./cmd/api

# Build the Go binary
build:
	cd backend && go build -o bin/api ./cmd/api

# Run the built binary
run: build
	cd backend && ./bin/api

# Docker Compose
docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

# Clean build artifacts and data
clean:
	rm -rf backend/bin
	rm -rf data/*.db data/*.db-shm data/*.db-wal

# Run tests
test:
	cd backend && go test ./...

# Format code
fmt:
	cd backend && go fmt ./...
