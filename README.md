# Plivo PubSub System

A simplified in-memory Pub/Sub system built with Node.js, featuring WebSocket endpoints for real-time messaging and HTTP REST APIs for topic management and observability.

## Features

### Core Functionality
- **Real-time messaging** via WebSocket connections (`/ws`)
- **Topic management** via REST API endpoints
- **Fan-out messaging** - every subscriber receives each message once
- **Topic isolation** - no cross-topic message leakage
- **Message replay** - ring buffer with configurable history size
- **Concurrency safety** for multiple publishers/subscribers
- **Backpressure handling** with configurable policies

### Operational Features
- **Health monitoring** with uptime and connection metrics
- **System statistics** with per-topic message/subscriber counts
- **Graceful shutdown** with connection cleanup
- **Heartbeat/ping-pong** for connection health monitoring
- **Docker support** for containerized deployment

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yadarj120/plivo-task
cd plivo

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on `http://localhost:3000` with WebSocket endpoint at `ws://localhost:3000/ws`.

### Docker Deployment

```bash
# Build the Docker image
docker build -t plivo-pubsub .

# Run the container
docker run -p 3000:3000 plivo-pubsub

# Run with custom configuration
docker run -p 8080:8080 -e PORT=8080 -e NODE_ENV=production plivo-pubsub
```

## API Reference

### REST Endpoints

#### Service Information
```http
GET /
```
Returns service information and available endpoints.

#### Health Check
```http
GET /health
```
Returns system health metrics:
```json
{
  "uptime_sec": 123,
  "topics": 2,
  "subscribers": 4
}
```

#### System Statistics
```http
GET /stats
```
Returns detailed statistics:
```json
{
  "topics": {
    "orders": {
      "messages": 42,
      "subscribers": 3
    }
  }
}
```

#### Topic Management

**List Topics**
```http
GET /topics
```

**Create Topic**
```http
POST /topics
Content-Type: application/json

{
  "name": "orders"
}
```

**Delete Topic**
```http
DELETE /topics/orders
```

### WebSocket Protocol

Connect to `ws://localhost:3000/ws` and send JSON messages:

#### Subscribe to Topic
```json
{
  "type": "subscribe",
  "topic": "orders",
  "client_id": "s1",
  "last_n": 5,
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Unsubscribe from Topic
```json
{
  "type": "unsubscribe",
  "topic": "orders",
  "client_id": "s1",
  "request_id": "340e8400-e29b-41d4-a716-446655448098"
}
```

#### Publish Message
```json
{
  "type": "publish",
  "topic": "orders",
  "message": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "payload": {
      "order_id": "ORD-123",
      "amount": "99.5",
      "currency": "USD"
    }
  },
  "request_id": "340e8400-e29b-41d4-a716-446655448098"
}
```

#### Ping/Pong
```json
{
  "type": "ping",
  "request_id": "570e8400-e29b-41d4-a716-446655441234"
}
```

### Server Messages

#### Acknowledgment
```json
{
  "type": "ack",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "topic": "orders",
  "status": "ok",
  "ts": "2025-08-25T10:00:00Z"
}
```

#### Event (Published Message)
```json
{
  "type": "event",
  "topic": "orders",
  "message": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "payload": {
      "order_id": "ORD-123",
      "amount": 99.5,
      "currency": "USD"
    }
  },
  "ts": "2025-08-25T10:01:00Z"
}
```

#### Error
```json
{
  "type": "error",
  "request_id": "req-67890",
  "error": {
    "code": "BAD_REQUEST",
    "message": "message.id must be a valid UUID"
  },
  "ts": "2025-08-25T10:02:00Z"
}
```

#### Pong Response
```json
{
  "type": "pong",
  "request_id": "ping-abc",
  "ts": "2025-08-25T10:03:00Z"
}
```

#### Info Messages
```json
{
  "type": "info",
  "topic": "orders",
  "msg": "topic_deleted",
  "ts": "2025-08-25T10:05:00Z"
}
```

## Configuration

### Environment Variables
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `NODE_ENV` - Environment mode (development/production)

### Command Line Options
```bash
node src/server.js --port 8080 --host localhost --max-queue-size 500 --ring-buffer-size 50 --backpressure-policy DROP_OLDEST
```

Available options:
- `--port` - Server port
- `--host` - Server host
- `--max-queue-size` - Maximum messages per subscriber queue (default: 1000)
- `--ring-buffer-size` - Message history size per topic (default: 100)
- `--backpressure-policy` - `DROP_OLDEST` or `DISCONNECT` (default: DROP_OLDEST)

## Architecture & Design Decisions

### Core Components

1. **PubSubSystem** (`src/pubsub.js`)
   - In-memory topic and subscriber management
   - Thread-safe operations with proper cleanup
   - Ring buffer for message history and replay functionality

2. **WebSocketHandler** (`src/websocket-handler.js`)
   - WebSocket connection lifecycle management
   - Message routing and validation
   - Heartbeat mechanism for connection health

3. **REST API** (`src/rest-api.js`)
   - Express.js-based HTTP endpoints
   - Topic management operations
   - Health and statistics monitoring

4. **Server** (`src/server.js`)
   - Main application entry point
   - Graceful shutdown handling
   - Configuration management

### Concurrency & Safety

- **Thread Safety**: Uses JavaScript's single-threaded nature with proper async/await patterns
- **Connection Management**: Automatic cleanup of disconnected subscribers
- **Resource Cleanup**: Proper cleanup on topic deletion and subscriber removal

### Backpressure Handling

Two configurable policies for handling slow consumers:

1. **DROP_OLDEST** (default): Remove oldest message when queue is full
2. **DISCONNECT**: Send error and close connection when queue overflows

### Message Guarantees

- **At-least-once delivery** for connected subscribers
- **Fan-out**: Every subscriber to a topic receives each message
- **Isolation**: Messages are only delivered to subscribers of the specific topic
- **Ordering**: Messages are delivered in publish order per topic

### Limitations & Assumptions

1. **In-Memory Only**: No persistence across server restarts
2. **Single Node**: No clustering or distributed setup
3. **Message Size**: Limited by Node.js memory and WebSocket frame limits
4. **Authentication**: No built-in authentication (can be added via middleware)
5. **Message Durability**: Messages are lost if all subscribers disconnect

### Error Handling

- **Connection Errors**: Automatic subscriber cleanup
- **Invalid Messages**: Proper error responses with error codes
- **Topic Errors**: Appropriate HTTP status codes and error messages
- **Server Errors**: Graceful error handling with optional debug information

## Testing

### Manual Testing with curl and wscat

```bash
# Install wscat for WebSocket testing
npm install -g wscat

# Test REST API
curl http://localhost:3000/health
curl -X POST -H "Content-Type: application/json" -d '{"name":"test"}' http://localhost:3000/topics

# Test WebSocket
wscat -c ws://localhost:3000/ws
# Then send: {"type":"subscribe","topic":"test","client_id":"c1"}
```

### Load Testing Considerations

- Monitor memory usage with multiple subscribers
- Test backpressure policies under high message rates
- Verify graceful degradation under resource constraints

## Production Considerations

### Security
- Add authentication middleware for REST and WebSocket endpoints
- Implement rate limiting to prevent abuse
- Use HTTPS/WSS in production environments
- Validate and sanitize all input data

### Monitoring
- Add structured logging with log levels
- Implement metrics collection (Prometheus/StatsD)
- Monitor memory usage and connection counts
- Set up alerts for error rates and resource usage

### Scaling
- Consider using Redis for shared state in multi-node setup
- Implement horizontal scaling with load balancers
- Add database persistence for message durability
- Consider message queuing systems for high-throughput scenarios

### Performance
- Tune garbage collection settings for high-frequency messaging
- Consider connection pooling for database operations
- Implement message batching for high-volume scenarios
- Monitor and optimize memory usage patterns

## License

ISC License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper error handling
4. Add tests for new functionality
5. Submit a pull request

---

Built with ❤️ for real-time messaging needs.
