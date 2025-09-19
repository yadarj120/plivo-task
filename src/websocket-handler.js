import { v4 as uuidv4 } from 'uuid';

/**
 * WebSocket message handler for the Pub/Sub system
 */
export class WebSocketHandler {
    constructor(pubsub) {
        this.pubsub = pubsub;
    }

    /**
     * Handle new WebSocket connection
     */
    handleConnection(ws, req) {
        const clientId = uuidv4();
        console.log(`New WebSocket connection: ${clientId}`);

        // Set up connection metadata
        ws.clientId = clientId;
        ws.isAlive = true;

        // Handle incoming messages
        ws.on('message', (data) => {
            this.handleMessage(ws, data);
        });

        // Handle connection close
        ws.on('close', (code, reason) => {
            console.log(`WebSocket connection closed: ${clientId}, code: ${code}, reason: ${reason}`);
            this.pubsub.removeSubscriber(clientId);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error(`WebSocket error for ${clientId}:`, error.message);
            this.pubsub.removeSubscriber(clientId);
        });

        // Handle ping/pong for connection health
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Send welcome message
        const welcomeMessage = {
            type: 'info',
            msg: 'connected',
            client_id: clientId,
            ts: new Date().toISOString()
        };

        try {
            ws.send(JSON.stringify(welcomeMessage));
        } catch (error) {
            console.error(`Failed to send welcome message to ${clientId}:`, error.message);
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    async handleMessage(ws, data) {
        const clientId = ws.clientId;

        try {
            // Parse message
            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (error) {
                this.sendError(ws, 'BAD_REQUEST', 'Invalid JSON format', null);
                return;
            }

            // Validate message structure
            if (!message.type) {
                this.sendError(ws, 'BAD_REQUEST', 'Missing message type', message.request_id);
                return;
            }

            // Validate message ID for publish messages
            if (message.type === 'publish' && message.message && message.message.id) {
                if (!this.isValidUUID(message.message.id)) {
                    this.sendError(ws, 'BAD_REQUEST', 'message.id must be a valid UUID', message.request_id);
                    return;
                }
            }

            // Route message based on type
            switch (message.type) {
                case 'subscribe':
                    await this.handleSubscribe(ws, message);
                    break;
                case 'unsubscribe':
                    await this.handleUnsubscribe(ws, message);
                    break;
                case 'publish':
                    await this.handlePublish(ws, message);
                    break;
                case 'ping':
                    await this.handlePing(ws, message);
                    break;
                default:
                    this.sendError(ws, 'BAD_REQUEST', `Unknown message type: ${message.type}`, message.request_id);
            }

        } catch (error) {
            console.error(`Error handling message from ${clientId}:`, error.message);
            this.sendError(ws, 'INTERNAL_ERROR', 'Internal server error', null);
        }
    }

    /**
     * Handle subscribe message
     */
    async handleSubscribe(ws, message) {
        const { topic, client_id, last_n = 0, request_id } = message;

        // Validate required fields
        if (!topic) {
            this.sendError(ws, 'BAD_REQUEST', 'Missing topic field', request_id);
            return;
        }

        if (!client_id) {
            this.sendError(ws, 'BAD_REQUEST', 'Missing client_id field', request_id);
            return;
        }

        try {
            // Attempt to subscribe
            const result = this.pubsub.subscribe(client_id, ws, topic, last_n);

            // Send acknowledgment
            const ackMessage = {
                type: 'ack',
                request_id,
                topic,
                status: 'ok',
                ts: new Date().toISOString()
            };

            ws.send(JSON.stringify(ackMessage));

        } catch (error) {
            let errorCode = 'INTERNAL_ERROR';
            if (error.message === 'TOPIC_NOT_FOUND') {
                errorCode = 'TOPIC_NOT_FOUND';
            }
            this.sendError(ws, errorCode, error.message, request_id);
        }
    }

    /**
     * Handle unsubscribe message
     */
    async handleUnsubscribe(ws, message) {
        const { topic, client_id, request_id } = message;

        // Validate required fields
        if (!topic) {
            this.sendError(ws, 'BAD_REQUEST', 'Missing topic field', request_id);
            return;
        }

        if (!client_id) {
            this.sendError(ws, 'BAD_REQUEST', 'Missing client_id field', request_id);
            return;
        }

        try {
            // Attempt to unsubscribe
            const result = this.pubsub.unsubscribe(client_id, topic);

            // Send acknowledgment
            const ackMessage = {
                type: 'ack',
                request_id,
                topic,
                status: 'ok',
                ts: new Date().toISOString()
            };

            ws.send(JSON.stringify(ackMessage));

        } catch (error) {
            let errorCode = 'INTERNAL_ERROR';
            if (error.message === 'SUBSCRIPTION_NOT_FOUND') {
                errorCode = 'TOPIC_NOT_FOUND';
            }
            this.sendError(ws, errorCode, error.message, request_id);
        }
    }

    /**
     * Handle publish message
     */
    async handlePublish(ws, message) {
        const { topic, message: payload, request_id } = message;

        // Validate required fields
        if (!topic) {
            this.sendError(ws, 'BAD_REQUEST', 'Missing topic field', request_id);
            return;
        }

        if (!payload) {
            this.sendError(ws, 'BAD_REQUEST', 'Missing message field', request_id);
            return;
        }

        try {
            // Attempt to publish
            const result = this.pubsub.publish(topic, payload);

            // Send acknowledgment
            const ackMessage = {
                type: 'ack',
                request_id,
                topic,
                status: 'ok',
                ts: new Date().toISOString()
            };

            ws.send(JSON.stringify(ackMessage));

        } catch (error) {
            let errorCode = 'INTERNAL_ERROR';
            if (error.message === 'TOPIC_NOT_FOUND') {
                errorCode = 'TOPIC_NOT_FOUND';
            }
            this.sendError(ws, errorCode, error.message, request_id);
        }
    }

    /**
     * Handle ping message
     */
    async handlePing(ws, message) {
        const { request_id } = message;

        const pongMessage = {
            type: 'pong',
            request_id,
            ts: new Date().toISOString()
        };

        try {
            ws.send(JSON.stringify(pongMessage));
        } catch (error) {
            console.error(`Failed to send pong to ${ws.clientId}:`, error.message);
        }
    }

    /**
     * Send error message to client
     */
    sendError(ws, code, message, requestId) {
        const errorMessage = {
            type: 'error',
            request_id: requestId,
            error: {
                code,
                message
            },
            ts: new Date().toISOString()
        };

        try {
            ws.send(JSON.stringify(errorMessage));
        } catch (error) {
            console.error(`Failed to send error message to ${ws.clientId}:`, error.message);
        }
    }

    /**
     * Validate UUID format
     */
    isValidUUID(str) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
    }

    /**
     * Set up periodic ping to check connection health
     */
    setupHeartbeat(wss) {
        const interval = setInterval(() => {
            wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log(`Terminating inactive connection: ${ws.clientId}`);
                    this.pubsub.removeSubscriber(ws.clientId);
                    return ws.terminate();
                }

                ws.isAlive = false;
                try {
                    ws.ping();
                } catch (error) {
                    console.warn(`Failed to ping client ${ws.clientId}:`, error.message);
                }
            });
        }, 30000); // 30 seconds

        // Clean up interval on server close
        wss.on('close', () => {
            clearInterval(interval);
        });

        return interval;
    }
}
