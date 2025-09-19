import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import http from 'http';

/**
 * Comprehensive demo showing REST API + WebSocket integration
 */
class FullDemo {
    constructor(baseUrl = 'http://localhost:3000', wsUrl = 'ws://localhost:3000/ws') {
        this.baseUrl = baseUrl;
        this.wsUrl = wsUrl;
    }

    // Helper function to make HTTP requests
    async makeRequest(path, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const req = http.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        resolve({ status: res.statusCode, data: parsed });
                    } catch (error) {
                        resolve({ status: res.statusCode, data: responseData });
                    }
                });
            });

            req.on('error', reject);

            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    // Create WebSocket client
    createWebSocketClient(name) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl);
            const clientId = `${name}-${Math.random().toString(36).substr(2, 9)}`;

            ws.clientName = name;
            ws.clientId = clientId;
            ws.messageLog = [];

            ws.on('open', () => {
                console.log(`🔌 ${name} connected`);
                resolve(ws);
            });

            ws.on('message', (data) => {
                const message = JSON.parse(data.toString());
                ws.messageLog.push(message);
                console.log(`📨 ${name} received:`, JSON.stringify(message, null, 2));
            });

            ws.on('error', reject);
            ws.on('close', (code, reason) => {
                console.log(`🔌 ${name} disconnected: ${code} ${reason}`);
            });
        });
    }

    // Send WebSocket message
    sendWsMessage(ws, message) {
        ws.send(JSON.stringify(message));
        console.log(`📤 ${ws.clientName} sent:`, JSON.stringify(message, null, 2));
    }

    async run() {
        console.log('🚀 Starting Full PubSub Demo');
        console.log('=============================');

        try {
            // Step 1: Check server health
            console.log('\n📋 Step 1: Check server health');
            const health = await this.makeRequest('/health');
            console.log('✅ Health check:', health.data);

            // Step 2: Create topic via REST API
            console.log('\n📋 Step 2: Create topic via REST API');
            const createResult = await this.makeRequest('/topics', 'POST', { name: 'orders' });
            console.log('✅ Topic created:', createResult.data);

            // Step 3: List topics
            console.log('\n📋 Step 3: List topics');
            const topics = await this.makeRequest('/topics');
            console.log('✅ Topics:', topics.data);

            // Step 4: Create WebSocket clients
            console.log('\n📋 Step 4: Create WebSocket clients');
            const publisher = await this.createWebSocketClient('Publisher');
            const subscriber1 = await this.createWebSocketClient('Subscriber1');
            const subscriber2 = await this.createWebSocketClient('Subscriber2');

            // Wait for connections to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 5: Subscribe to topic
            console.log('\n📋 Step 5: Subscribe to orders topic');
            this.sendWsMessage(subscriber1, {
                type: 'subscribe',
                topic: 'orders',
                client_id: subscriber1.clientId,
                request_id: uuidv4()
            });

            this.sendWsMessage(subscriber2, {
                type: 'subscribe',
                topic: 'orders',
                client_id: subscriber2.clientId,
                request_id: uuidv4()
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 6: Check topics again (should show subscribers)
            console.log('\n📋 Step 6: Check topics with subscribers');
            const topicsWithSubs = await this.makeRequest('/topics');
            console.log('✅ Topics with subscribers:', topicsWithSubs.data);

            // Step 7: Publish messages
            console.log('\n📋 Step 7: Publish messages');
            this.sendWsMessage(publisher, {
                type: 'publish',
                topic: 'orders',
                message: {
                    id: uuidv4(),
                    payload: {
                        order_id: 'ORD-001',
                        amount: 99.99,
                        currency: 'USD',
                        customer: 'john@example.com'
                    }
                },
                request_id: uuidv4()
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            this.sendWsMessage(publisher, {
                type: 'publish',
                topic: 'orders',
                message: {
                    id: uuidv4(),
                    payload: {
                        order_id: 'ORD-002',
                        amount: 149.50,
                        currency: 'USD',
                        customer: 'jane@example.com'
                    }
                },
                request_id: uuidv4()
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 8: Test message replay
            console.log('\n📋 Step 8: Test message replay with new subscriber');
            const subscriber3 = await this.createWebSocketClient('Subscriber3');
            await new Promise(resolve => setTimeout(resolve, 500));

            this.sendWsMessage(subscriber3, {
                type: 'subscribe',
                topic: 'orders',
                client_id: subscriber3.clientId,
                last_n: 2, // Request last 2 messages
                request_id: uuidv4()
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 9: Check statistics
            console.log('\n📋 Step 9: Check system statistics');
            const stats = await this.makeRequest('/stats');
            console.log('✅ Statistics:', stats.data);

            // Step 10: Test ping/pong
            console.log('\n📋 Step 10: Test ping/pong');
            this.sendWsMessage(subscriber1, {
                type: 'ping',
                request_id: uuidv4()
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 11: Unsubscribe
            console.log('\n📋 Step 11: Test unsubscribe');
            this.sendWsMessage(subscriber1, {
                type: 'unsubscribe',
                topic: 'orders',
                client_id: subscriber1.clientId,
                request_id: uuidv4()
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 12: Delete topic (will notify remaining subscribers)
            console.log('\n📋 Step 12: Delete topic via REST API');
            const deleteResult = await this.makeRequest('/topics/orders', 'DELETE');
            console.log('✅ Topic deleted:', deleteResult.data);

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 13: Final health check
            console.log('\n📋 Step 13: Final health check');
            const finalHealth = await this.makeRequest('/health');
            console.log('✅ Final health:', finalHealth.data);

            console.log('\n🎉 Full demo completed successfully!');

            // Clean up
            publisher.close();
            subscriber1.close();
            subscriber2.close();
            subscriber3.close();

        } catch (error) {
            console.error('❌ Demo failed:', error.message);
        }

        // Exit after cleanup
        setTimeout(() => {
            process.exit(0);
        }, 2000);
    }
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const demo = new FullDemo();
    demo.run().catch(console.error);
}

export { FullDemo };
