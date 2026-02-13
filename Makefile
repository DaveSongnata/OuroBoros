.PHONY: dev build run clean docker-up docker-down stop test fmt

# Development: start Redis in Docker, then run Go backend
dev:
	@echo "=> Starting Redis via Docker Compose..."
	docker compose up -d redis
	@echo "=> Waiting for Redis to be ready..."
	@until docker compose exec redis valkey-cli ping 2>/dev/null | grep -q PONG; do sleep 0.5; done
	@echo "=> Redis is up. Starting Go API..."
	cd backend && go run ./cmd/api

# Stop infrastructure containers (Redis, etc.)
stop:
	docker compose stop

# Build the Go binary
build:
	cd backend && go build -o bin/api ./cmd/api

# Run the built binary (starts Redis first)
run: build
	docker compose up -d redis
	@until docker compose exec redis valkey-cli ping 2>/dev/null | grep -q PONG; do sleep 0.5; done
	cd backend && ./bin/api

# Full Docker Compose stack
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
