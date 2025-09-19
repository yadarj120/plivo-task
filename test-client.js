import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

/**
 * Simple test client to demonstrate WebSocket functionality
 */
class TestClient {
    constructor(url = 'ws://localhost:3000/ws') {
        this.url = url;
        this.ws = null;
        this.clientId = `client-${Math.random().toString(36).substr(2, 9)}`;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);

            this.ws.on('open', () => {
                console.log(`🔌 Connected to ${this.url}`);
                resolve();
            });

            this.ws.on('message', (data) => {
                const message = JSON.parse(data.toString());
                console.log('📨 Received:', JSON.stringify(message, null, 2));
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error.message);
                reject(error);
            });

            this.ws.on('close', (code, reason) => {
                console.log(`🔌 Connection closed: ${code} ${reason}`);
            });
        });
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            console.log('📤 Sent:', JSON.stringify(message, null, 2));
        } else {
            console.error('❌ WebSocket not connected');
        }
    }

    subscribe(topic, lastN = 0) {
        this.send({
            type: 'subscribe',
            topic,
            client_id: this.clientId,
            last_n: lastN,
            request_id: uuidv4()
        });
    }

    publish(topic, payload) {
        this.send({
            type: 'publish',
            topic,
            message: {
                id: uuidv4(),
                payload
            },
            request_id: uuidv4()
        });
    }

    ping() {
        this.send({
            type: 'ping',
            request_id: uuidv4()
        });
    }

    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

/**
 * Demo function showing typical usage
 */
async function demo() {
    console.log('🚀 Starting PubSub WebSocket Demo');
    console.log('=====================================');

    // Create two clients
    const publisher = new TestClient();
    const subscriber = new TestClient();

    try {
        // Connect both clients
        await publisher.connect();
        await subscriber.connect();

        // Wait a bit for connections to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Subscriber subscribes to 'orders' topic
        console.log('\n📋 Step 1: Subscribe to orders topic');
        subscriber.subscribe('orders');

        // Wait for subscription to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Publisher sends some messages
        console.log('\n📋 Step 2: Publish messages to orders topic');
        publisher.publish('orders', {
            order_id: 'ORD-001',
            amount: 99.99,
            currency: 'USD',
            customer: 'john@example.com'
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        publisher.publish('orders', {
            order_id: 'ORD-002',
            amount: 149.50,
            currency: 'USD',
            customer: 'jane@example.com'
        });

        // Wait for messages to be delivered
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test ping/pong
        console.log('\n📋 Step 3: Test ping/pong');
        subscriber.ping();

        // Wait a bit more
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('\n✅ Demo completed successfully!');

    } catch (error) {
        console.error('❌ Demo failed:', error.message);
    } finally {
        // Clean up
        publisher.close();
        subscriber.close();

        // Exit after a short delay
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    demo().catch(console.error);
}

export { TestClient };
