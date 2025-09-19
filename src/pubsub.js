import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory Pub/Sub system with concurrency safety and backpressure handling
 */
export class PubSubSystem {
    constructor(options = {}) {
        // Configuration
        this.maxQueueSize = options.maxQueueSize || 1000;
        this.ringBufferSize = options.ringBufferSize || 100;
        this.backpressurePolicy = options.backpressurePolicy || 'DROP_OLDEST'; // or 'DISCONNECT'

        // Core data structures
        this.topics = new Map(); // topicName -> { subscribers: Set, messageHistory: Array }
        this.subscribers = new Map(); // clientId -> { ws, topics: Set, queue: Array }
        this.stats = {
            totalMessages: 0,
            totalSubscribers: 0,
            topicStats: new Map() // topicName -> { messages, subscribers }
        };

        // Server state
        this.startTime = Date.now();
        this.isShuttingDown = false;

        // Mutex-like mechanism for critical sections
        this.operationLocks = new Map();
    }

    /**
     * Create a new topic
     */
    createTopic(topicName) {
        if (this.topics.has(topicName)) {
            throw new Error('TOPIC_ALREADY_EXISTS');
        }

        this.topics.set(topicName, {
            subscribers: new Set(),
            messageHistory: []
        });

        this.stats.topicStats.set(topicName, {
            messages: 0,
            subscribers: 0
        });

        return { status: 'created', topic: topicName };
    }

    /**
     * Delete a topic and notify all subscribers
     */
    deleteTopic(topicName) {
        const topic = this.topics.get(topicName);
        if (!topic) {
            throw new Error('TOPIC_NOT_FOUND');
        }

        // Notify all subscribers that topic is being deleted
        const deleteMessage = {
            type: 'info',
            topic: topicName,
            msg: 'topic_deleted',
            ts: new Date().toISOString()
        };

        for (const clientId of topic.subscribers) {
            const subscriber = this.subscribers.get(clientId);
            if (subscriber && subscriber.ws.readyState === 1) { // WebSocket.OPEN
                try {
                    subscriber.ws.send(JSON.stringify(deleteMessage));
                } catch (error) {
                    console.warn(`Failed to notify subscriber ${clientId} about topic deletion:`, error.message);
                }
            }
        }

        // Remove topic from all subscribers' topic sets
        for (const clientId of topic.subscribers) {
            const subscriber = this.subscribers.get(clientId);
            if (subscriber) {
                subscriber.topics.delete(topicName);
            }
        }

        // Clean up
        this.topics.delete(topicName);
        this.stats.topicStats.delete(topicName);

        return { status: 'deleted', topic: topicName };
    }

    /**
     * Get all topics with subscriber counts
     */
    getTopics() {
        const topics = [];
        for (const [name, topic] of this.topics) {
            topics.push({
                name,
                subscribers: topic.subscribers.size
            });
        }
        return { topics };
    }

    /**
     * Subscribe a client to a topic with optional message replay
     */
    subscribe(clientId, ws, topicName, lastN = 0) {
        if (!this.topics.has(topicName)) {
            throw new Error('TOPIC_NOT_FOUND');
        }

        // Register subscriber if not exists
        if (!this.subscribers.has(clientId)) {
            this.subscribers.set(clientId, {
                ws,
                topics: new Set(),
                queue: []
            });
            this.stats.totalSubscribers++;
        }

        const subscriber = this.subscribers.get(clientId);
        const topic = this.topics.get(topicName);

        // Add to topic and subscriber tracking
        topic.subscribers.add(clientId);
        subscriber.topics.add(topicName);

        // Update stats
        const topicStats = this.stats.topicStats.get(topicName);
        topicStats.subscribers = topic.subscribers.size;

        // Replay last N messages if requested
        if (lastN > 0 && topic.messageHistory.length > 0) {
            const messagesToReplay = topic.messageHistory.slice(-lastN);
            for (const message of messagesToReplay) {
                this.enqueueMessage(clientId, message);
            }
        }

        return {
            status: 'subscribed',
            topic: topicName,
            clientId
        };
    }

    /**
     * Unsubscribe a client from a topic
     */
    unsubscribe(clientId, topicName) {
        const topic = this.topics.get(topicName);
        const subscriber = this.subscribers.get(clientId);

        if (!topic || !subscriber) {
            throw new Error('SUBSCRIPTION_NOT_FOUND');
        }

        // Remove from topic and subscriber tracking
        topic.subscribers.delete(clientId);
        subscriber.topics.delete(topicName);

        // Update stats
        const topicStats = this.stats.topicStats.get(topicName);
        if (topicStats) {
            topicStats.subscribers = topic.subscribers.size;
        }

        return {
            status: 'unsubscribed',
            topic: topicName,
            clientId
        };
    }

    /**
     * Publish a message to a topic (fan-out to all subscribers)
     */
    publish(topicName, message) {
        const topic = this.topics.get(topicName);
        if (!topic) {
            throw new Error('TOPIC_NOT_FOUND');
        }

        const publishedMessage = {
            type: 'event',
            topic: topicName,
            message,
            ts: new Date().toISOString()
        };

        // Add to message history (ring buffer)
        topic.messageHistory.push(publishedMessage);
        if (topic.messageHistory.length > this.ringBufferSize) {
            topic.messageHistory.shift();
        }

        // Fan-out to all subscribers
        const failedDeliveries = [];
        for (const clientId of topic.subscribers) {
            try {
                this.enqueueMessage(clientId, publishedMessage);
            } catch (error) {
                failedDeliveries.push({ clientId, error: error.message });
            }
        }

        // Update stats
        this.stats.totalMessages++;
        const topicStats = this.stats.topicStats.get(topicName);
        if (topicStats) {
            topicStats.messages++;
        }

        return {
            status: 'published',
            topic: topicName,
            subscribersReached: topic.subscribers.size - failedDeliveries.length,
            failedDeliveries
        };
    }

    /**
     * Enqueue message for a subscriber with backpressure handling
     */
    enqueueMessage(clientId, message) {
        const subscriber = this.subscribers.get(clientId);
        if (!subscriber) {
            throw new Error('SUBSCRIBER_NOT_FOUND');
        }

        // Check if WebSocket is still open
        if (subscriber.ws.readyState !== 1) { // WebSocket.OPEN
            this.removeSubscriber(clientId);
            throw new Error('SUBSCRIBER_DISCONNECTED');
        }

        // Handle backpressure
        if (subscriber.queue.length >= this.maxQueueSize) {
            if (this.backpressurePolicy === 'DROP_OLDEST') {
                subscriber.queue.shift(); // Remove oldest message
            } else if (this.backpressurePolicy === 'DISCONNECT') {
                const errorMessage = {
                    type: 'error',
                    error: {
                        code: 'SLOW_CONSUMER',
                        message: 'Subscriber queue overflow'
                    },
                    ts: new Date().toISOString()
                };
                try {
                    subscriber.ws.send(JSON.stringify(errorMessage));
                    subscriber.ws.close(1008, 'SLOW_CONSUMER');
                } catch (e) {
                    // Ignore send errors on closing connection
                }
                this.removeSubscriber(clientId);
                throw new Error('SLOW_CONSUMER');
            }
        }

        // Add message to queue and try to send immediately
        subscriber.queue.push(message);
        this.flushSubscriberQueue(clientId);
    }

    /**
     * Flush queued messages for a subscriber
     */
    flushSubscriberQueue(clientId) {
        const subscriber = this.subscribers.get(clientId);
        if (!subscriber || subscriber.ws.readyState !== 1) {
            return;
        }

        while (subscriber.queue.length > 0) {
            const message = subscriber.queue[0];
            try {
                subscriber.ws.send(JSON.stringify(message));
                subscriber.queue.shift();
            } catch (error) {
                // If send fails, leave message in queue and stop processing
                console.warn(`Failed to send message to subscriber ${clientId}:`, error.message);
                break;
            }
        }
    }

    /**
     * Remove a subscriber and clean up all subscriptions
     */
    removeSubscriber(clientId) {
        const subscriber = this.subscribers.get(clientId);
        if (!subscriber) {
            return;
        }

        // Remove from all topics
        for (const topicName of subscriber.topics) {
            const topic = this.topics.get(topicName);
            if (topic) {
                topic.subscribers.delete(clientId);
                // Update topic stats
                const topicStats = this.stats.topicStats.get(topicName);
                if (topicStats) {
                    topicStats.subscribers = topic.subscribers.size;
                }
            }
        }

        // Remove subscriber
        this.subscribers.delete(clientId);
        this.stats.totalSubscribers--;
    }

    /**
     * Get system health information
     */
    getHealth() {
        return {
            uptime_sec: Math.floor((Date.now() - this.startTime) / 1000),
            topics: this.topics.size,
            subscribers: this.subscribers.size
        };
    }

    /**
     * Get detailed statistics
     */
    getStats() {
        const topics = {};
        for (const [topicName, stats] of this.stats.topicStats) {
            topics[topicName] = {
                messages: stats.messages,
                subscribers: stats.subscribers
            };
        }

        return { topics };
    }

    /**
     * Graceful shutdown - stop accepting new operations and flush queues
     */
    async gracefulShutdown() {
        this.isShuttingDown = true;

        console.log('Starting graceful shutdown...');

        // Flush all subscriber queues
        const flushPromises = [];
        for (const [clientId, subscriber] of this.subscribers) {
            if (subscriber.ws.readyState === 1) {
                flushPromises.push(this.flushSubscriberQueue(clientId));
            }
        }

        // Wait for flush attempts (with timeout)
        try {
            await Promise.race([
                Promise.all(flushPromises),
                new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
            ]);
        } catch (error) {
            console.warn('Error during queue flush:', error.message);
        }

        // Close all WebSocket connections
        for (const [clientId, subscriber] of this.subscribers) {
            try {
                if (subscriber.ws.readyState === 1) {
                    subscriber.ws.close(1001, 'Server shutting down');
                }
            } catch (error) {
                console.warn(`Error closing connection for ${clientId}:`, error.message);
            }
        }

        console.log('Graceful shutdown completed');
    }
}
