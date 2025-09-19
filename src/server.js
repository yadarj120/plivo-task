import http from 'http';
import { WebSocketServer } from 'ws';
import { PubSubSystem } from './pubsub.js';
import { WebSocketHandler } from './websocket-handler.js';
import { createExpressApp } from './rest-api.js';

/**
 * Main server class that combines HTTP REST API and WebSocket endpoints
 */
class PubSubServer {
    constructor(options = {}) {
        this.port = options.port || process.env.PORT || 3000;
        this.host = options.host || process.env.HOST || '0.0.0.0';

        // Initialize core components
        this.pubsub = new PubSubSystem({
            maxQueueSize: options.maxQueueSize || 1000,
            ringBufferSize: options.ringBufferSize || 100,
            backpressurePolicy: options.backpressurePolicy || 'DROP_OLDEST'
        });

        this.wsHandler = new WebSocketHandler(this.pubsub);
        this.app = createExpressApp(this.pubsub);

        // Create HTTP server
        this.server = http.createServer(this.app);

        // Create WebSocket server
        this.wss = new WebSocketServer({
            server: this.server,
            path: '/ws'
        });

        this.setupWebSocketServer();
        this.setupGracefulShutdown();
    }

    /**
     * Set up WebSocket server event handlers
     */
    setupWebSocketServer() {
        this.wss.on('connection', (ws, req) => {
            this.wsHandler.handleConnection(ws, req);
        });

        this.wss.on('error', (error) => {
            console.error('WebSocket Server Error:', error);
        });

        // Set up heartbeat mechanism
        this.heartbeatInterval = this.wsHandler.setupHeartbeat(this.wss);
    }

    /**
     * Set up graceful shutdown handlers
     */
    setupGracefulShutdown() {
        const gracefulShutdown = async (signal) => {
            console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

            try {
                // Stop accepting new connections
                this.server.close(() => {
                    console.log('HTTP server closed');
                });

                // Close WebSocket server
                this.wss.close(() => {
                    console.log('WebSocket server closed');
                });

                // Clear heartbeat interval
                if (this.heartbeatInterval) {
                    clearInterval(this.heartbeatInterval);
                }

                // Graceful shutdown of PubSub system
                await this.pubsub.gracefulShutdown();

                console.log('Graceful shutdown completed');
                process.exit(0);

            } catch (error) {
                console.error('Error during graceful shutdown:', error);
                process.exit(1);
            }
        };

        // Handle shutdown signals
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            gracefulShutdown('UNCAUGHT_EXCEPTION');
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            gracefulShutdown('UNHANDLED_REJECTION');
        });
    }

    /**
     * Start the server
     */
    async start() {
        return new Promise((resolve, reject) => {
            this.server.listen(this.port, this.host, (error) => {
                if (error) {
                    reject(error);
                    return;
                }

                console.log('='.repeat(60));
                console.log('🚀 Plivo PubSub Server Started');
                console.log('='.repeat(60));
                console.log(`📍 HTTP Server: http://${this.host}:${this.port}`);
                console.log(`🔌 WebSocket: ws://${this.host}:${this.port}/ws`);
                console.log('='.repeat(60));
                console.log('📋 Available Endpoints:');
                console.log('   GET    /           - Service info');
                console.log('   GET    /health     - Health check');
                console.log('   GET    /stats      - System statistics');
                console.log('   GET    /topics     - List topics');
                console.log('   POST   /topics     - Create topic');
                console.log('   DELETE /topics/:name - Delete topic');
                console.log('   WS     /ws         - WebSocket endpoint');
                console.log('='.repeat(60));
                console.log('📊 Configuration:');
                console.log(`   Max Queue Size: ${this.pubsub.maxQueueSize}`);
                console.log(`   Ring Buffer Size: ${this.pubsub.ringBufferSize}`);
                console.log(`   Backpressure Policy: ${this.pubsub.backpressurePolicy}`);
                console.log('='.repeat(60));

                resolve();
            });
        });
    }

    /**
     * Stop the server
     */
    async stop() {
        return new Promise((resolve) => {
            this.server.close(() => {
                console.log('Server stopped');
                resolve();
            });
        });
    }
}

/**
 * Main entry point
 */
async function main() {
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        const options = {};

        for (let i = 0; i < args.length; i += 2) {
            const key = args[i];
            const value = args[i + 1];

            switch (key) {
                case '--port':
                    options.port = parseInt(value, 10);
                    break;
                case '--host':
                    options.host = value;
                    break;
                case '--max-queue-size':
                    options.maxQueueSize = parseInt(value, 10);
                    break;
                case '--ring-buffer-size':
                    options.ringBufferSize = parseInt(value, 10);
                    break;
                case '--backpressure-policy':
                    if (['DROP_OLDEST', 'DISCONNECT'].includes(value)) {
                        options.backpressurePolicy = value;
                    }
                    break;
            }
        }

        // Create and start server
        const server = new PubSubServer(options);
        await server.start();

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { PubSubServer };
