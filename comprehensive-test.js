import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import http from 'http';

/**
 * Comprehensive test suite for Plivo PubSub System
 * Tests all WebSocket operations and REST API endpoints with detailed logging
 */
class ComprehensiveTest {
    constructor(baseUrl = 'http://localhost:3000', wsUrl = 'ws://localhost:3000/ws') {
        this.baseUrl = baseUrl;
        this.wsUrl = wsUrl;
        this.testResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    // Logging utilities
    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const colors = {
            'INFO': '\x1b[36m',    // Cyan
            'SUCCESS': '\x1b[32m', // Green
            'ERROR': '\x1b[31m',   // Red
            'REQUEST': '\x1b[33m', // Yellow
            'RESPONSE': '\x1b[35m' // Magenta
        };
        console.log(`${colors[type]}[${timestamp}] ${type}: ${message}\x1b[0m`);
    }

    logRequest(method, url, data = null) {
        this.log(`${method} ${url}`, 'REQUEST');
        if (data) {
            this.log(`Request Body: ${JSON.stringify(data, null, 2)}`, 'REQUEST');
        }
    }

    logResponse(status, data) {
        this.log(`Response Status: ${status}`, 'RESPONSE');
        this.log(`Response Body: ${JSON.stringify(data, null, 2)}`, 'RESPONSE');
    }

    logWebSocketMessage(direction, clientName, message) {
        const arrow = direction === 'SEND' ? '📤' : '📨';
        this.log(`${arrow} ${clientName} ${direction}: ${JSON.stringify(message, null, 2)}`, direction === 'SEND' ? 'REQUEST' : 'RESPONSE');
    }

    // Test result tracking
    recordTest(testName, passed, details = '') {
        this.testResults.tests.push({ testName, passed, details });
        if (passed) {
            this.testResults.passed++;
            this.log(`✅ PASS: ${testName} ${details}`, 'SUCCESS');
        } else {
            this.testResults.failed++;
            this.log(`❌ FAIL: ${testName} ${details}`, 'ERROR');
        }
    }

    // HTTP Request helper
    async makeRequest(path, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            this.logRequest(method, `${this.baseUrl}${path}`, data);

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
                        this.logResponse(res.statusCode, parsed);
                        resolve({ status: res.statusCode, data: parsed });
                    } catch (error) {
                        this.logResponse(res.statusCode, responseData);
                        resolve({ status: res.statusCode, data: responseData });
                    }
                });
            });

            req.on('error', (error) => {
                this.log(`Request failed: ${error.message}`, 'ERROR');
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    // WebSocket client helper
    createWebSocketClient(name) {
        return new Promise((resolve, reject) => {
            this.log(`Creating WebSocket connection for ${name}`, 'INFO');
            const ws = new WebSocket(this.wsUrl);
            const clientId = `${name}-${Math.random().toString(36).substr(2, 9)}`;

            ws.clientName = name;
            ws.clientId = clientId;
            ws.messageLog = [];

            ws.on('open', () => {
                this.log(`🔌 ${name} connected to ${this.wsUrl}`, 'SUCCESS');
                resolve(ws);
            });

            ws.on('message', (data) => {
                const message = JSON.parse(data.toString());
                ws.messageLog.push(message);
                this.logWebSocketMessage('RECEIVE', name, message);
            });

            ws.on('error', (error) => {
                this.log(`WebSocket error for ${name}: ${error.message}`, 'ERROR');
                reject(error);
            });

            ws.on('close', (code, reason) => {
                this.log(`🔌 ${name} disconnected: ${code} ${reason}`, 'INFO');
            });
        });
    }

    // Send WebSocket message
    sendWsMessage(ws, message) {
        this.logWebSocketMessage('SEND', ws.clientName, message);
        ws.send(JSON.stringify(message));
    }

    // Wait helper
    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Test REST API endpoints
    async testRestEndpoints() {
        this.log('='.repeat(60), 'INFO');
        this.log('TESTING REST API ENDPOINTS', 'INFO');
        this.log('='.repeat(60), 'INFO');

        // Test 1: Health check
        try {
            const health = await this.makeRequest('/health');
            this.recordTest('GET /health',
                health.status === 200 &&
                health.data.hasOwnProperty('uptime_sec') &&
                health.data.hasOwnProperty('topics') &&
                health.data.hasOwnProperty('subscribers'),
                `Status: ${health.status}`
            );
        } catch (error) {
            this.recordTest('GET /health', false, `Error: ${error.message}`);
        }

        // Test 2: Service info
        try {
            const info = await this.makeRequest('/');
            this.recordTest('GET /',
                info.status === 200 &&
                info.data.hasOwnProperty('service'),
                `Status: ${info.status}`
            );
        } catch (error) {
            this.recordTest('GET /', false, `Error: ${error.message}`);
        }

        // Test 3: List topics (empty)
        try {
            const topics = await this.makeRequest('/topics');
            this.recordTest('GET /topics (empty)',
                topics.status === 200 &&
                Array.isArray(topics.data.topics),
                `Status: ${topics.status}, Topics: ${topics.data.topics.length}`
            );
        } catch (error) {
            this.recordTest('GET /topics (empty)', false, `Error: ${error.message}`);
        }

        // Test 4: Create topic
        try {
            const create = await this.makeRequest('/topics', 'POST', { name: 'test-topic' });
            this.recordTest('POST /topics (create)',
                create.status === 201 &&
                create.data.status === 'created' &&
                create.data.topic === 'test-topic',
                `Status: ${create.status}`
            );
        } catch (error) {
            this.recordTest('POST /topics (create)', false, `Error: ${error.message}`);
        }

        // Test 5: Create duplicate topic (should fail)
        try {
            const duplicate = await this.makeRequest('/topics', 'POST', { name: 'test-topic' });
            this.recordTest('POST /topics (duplicate)',
                duplicate.status === 409,
                `Status: ${duplicate.status}`
            );
        } catch (error) {
            this.recordTest('POST /topics (duplicate)', false, `Error: ${error.message}`);
        }

        // Test 6: List topics (with data)
        try {
            const topics = await this.makeRequest('/topics');
            this.recordTest('GET /topics (with data)',
                topics.status === 200 &&
                topics.data.topics.length > 0 &&
                topics.data.topics[0].name === 'test-topic',
                `Status: ${topics.status}, Topics: ${topics.data.topics.length}`
            );
        } catch (error) {
            this.recordTest('GET /topics (with data)', false, `Error: ${error.message}`);
        }

        // Test 7: Get stats
        try {
            const stats = await this.makeRequest('/stats');
            this.recordTest('GET /stats',
                stats.status === 200 &&
                stats.data.hasOwnProperty('topics'),
                `Status: ${stats.status}`
            );
        } catch (error) {
            this.recordTest('GET /stats', false, `Error: ${error.message}`);
        }

        // Test 8: Invalid endpoint
        try {
            const invalid = await this.makeRequest('/invalid-endpoint');
            this.recordTest('GET /invalid-endpoint',
                invalid.status === 404,
                `Status: ${invalid.status}`
            );
        } catch (error) {
            this.recordTest('GET /invalid-endpoint', false, `Error: ${error.message}`);
        }

        // Test 9: Invalid POST data
        try {
            const invalidPost = await this.makeRequest('/topics', 'POST', { invalid: 'data' });
            this.recordTest('POST /topics (invalid data)',
                invalidPost.status === 400,
                `Status: ${invalidPost.status}`
            );
        } catch (error) {
            this.recordTest('POST /topics (invalid data)', false, `Error: ${error.message}`);
        }
    }

    // Test WebSocket functionality
    async testWebSocketOperations() {
        this.log('='.repeat(60), 'INFO');
        this.log('TESTING WEBSOCKET OPERATIONS', 'INFO');
        this.log('='.repeat(60), 'INFO');

        let publisher, subscriber1, subscriber2, subscriber3;

        try {
            // Create WebSocket clients
            publisher = await this.createWebSocketClient('Publisher');
            subscriber1 = await this.createWebSocketClient('Subscriber1');
            subscriber2 = await this.createWebSocketClient('Subscriber2');

            await this.wait(1000);

            // Test 1: Subscribe to existing topic
            const subscribeMsg1 = {
                type: 'subscribe',
                topic: 'test-topic',
                client_id: subscriber1.clientId,
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber1, subscribeMsg1);
            await this.wait(500);

            const ackReceived1 = subscriber1.messageLog.some(msg =>
                msg.type === 'ack' && msg.request_id === subscribeMsg1.request_id
            );
            this.recordTest('WebSocket Subscribe (valid topic)', ackReceived1,
                `Request ID: ${subscribeMsg1.request_id}`);

            // Test 2: Subscribe to non-existent topic
            const subscribeMsg2 = {
                type: 'subscribe',
                topic: 'non-existent-topic',
                client_id: subscriber2.clientId,
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber2, subscribeMsg2);
            await this.wait(500);

            const errorReceived = subscriber2.messageLog.some(msg =>
                msg.type === 'error' &&
                msg.request_id === subscribeMsg2.request_id &&
                msg.error.code === 'TOPIC_NOT_FOUND'
            );
            this.recordTest('WebSocket Subscribe (invalid topic)', errorReceived,
                `Request ID: ${subscribeMsg2.request_id}`);

            // Test 3: Subscribe second client to same topic
            const subscribeMsg3 = {
                type: 'subscribe',
                topic: 'test-topic',
                client_id: subscriber2.clientId,
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber2, subscribeMsg3);
            await this.wait(500);

            const ackReceived2 = subscriber2.messageLog.some(msg =>
                msg.type === 'ack' && msg.request_id === subscribeMsg3.request_id
            );
            this.recordTest('WebSocket Subscribe (multiple clients)', ackReceived2,
                `Request ID: ${subscribeMsg3.request_id}`);

            // Test 4: Publish message
            const publishMsg = {
                type: 'publish',
                topic: 'test-topic',
                message: {
                    id: uuidv4(),
                    payload: {
                        order_id: 'TEST-001',
                        amount: 99.99,
                        currency: 'USD'
                    }
                },
                request_id: uuidv4()
            };
            this.sendWsMessage(publisher, publishMsg);
            await this.wait(500);

            const publishAck = publisher.messageLog.some(msg =>
                msg.type === 'ack' && msg.request_id === publishMsg.request_id
            );
            this.recordTest('WebSocket Publish (valid)', publishAck,
                `Request ID: ${publishMsg.request_id}`);

            // Test 5: Verify fan-out (both subscribers receive message)
            const eventReceived1 = subscriber1.messageLog.some(msg =>
                msg.type === 'event' &&
                msg.topic === 'test-topic' &&
                msg.message.id === publishMsg.message.id
            );
            const eventReceived2 = subscriber2.messageLog.some(msg =>
                msg.type === 'event' &&
                msg.topic === 'test-topic' &&
                msg.message.id === publishMsg.message.id
            );
            this.recordTest('WebSocket Fan-out', eventReceived1 && eventReceived2,
                `Subscriber1: ${eventReceived1}, Subscriber2: ${eventReceived2}`);

            // Test 6: Publish to non-existent topic
            const invalidPublishMsg = {
                type: 'publish',
                topic: 'invalid-topic',
                message: {
                    id: uuidv4(),
                    payload: { test: 'data' }
                },
                request_id: uuidv4()
            };
            this.sendWsMessage(publisher, invalidPublishMsg);
            await this.wait(500);

            const publishError = publisher.messageLog.some(msg =>
                msg.type === 'error' &&
                msg.request_id === invalidPublishMsg.request_id &&
                msg.error.code === 'TOPIC_NOT_FOUND'
            );
            this.recordTest('WebSocket Publish (invalid topic)', publishError,
                `Request ID: ${invalidPublishMsg.request_id}`);

            // Test 7: Ping/Pong
            const pingMsg = {
                type: 'ping',
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber1, pingMsg);
            await this.wait(500);

            const pongReceived = subscriber1.messageLog.some(msg =>
                msg.type === 'pong' && msg.request_id === pingMsg.request_id
            );
            this.recordTest('WebSocket Ping/Pong', pongReceived,
                `Request ID: ${pingMsg.request_id}`);

            // Test 8: Message replay with new subscriber
            subscriber3 = await this.createWebSocketClient('Subscriber3');
            await this.wait(500);

            // Publish another message first
            const publishMsg2 = {
                type: 'publish',
                topic: 'test-topic',
                message: {
                    id: uuidv4(),
                    payload: {
                        order_id: 'TEST-002',
                        amount: 149.50,
                        currency: 'USD'
                    }
                },
                request_id: uuidv4()
            };
            this.sendWsMessage(publisher, publishMsg2);
            await this.wait(500);

            // Subscribe with replay
            const replaySubscribeMsg = {
                type: 'subscribe',
                topic: 'test-topic',
                client_id: subscriber3.clientId,
                last_n: 2,
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber3, replaySubscribeMsg);
            await this.wait(1000);

            const replayEvents = subscriber3.messageLog.filter(msg => msg.type === 'event');
            this.recordTest('WebSocket Message Replay', replayEvents.length >= 2,
                `Replayed messages: ${replayEvents.length}`);

            // Test 9: Unsubscribe
            const unsubscribeMsg = {
                type: 'unsubscribe',
                topic: 'test-topic',
                client_id: subscriber1.clientId,
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber1, unsubscribeMsg);
            await this.wait(500);

            const unsubscribeAck = subscriber1.messageLog.some(msg =>
                msg.type === 'ack' && msg.request_id === unsubscribeMsg.request_id
            );
            this.recordTest('WebSocket Unsubscribe', unsubscribeAck,
                `Request ID: ${unsubscribeMsg.request_id}`);

            // Test 10: Verify unsubscribed client doesn't receive new messages
            const testPublishMsg = {
                type: 'publish',
                topic: 'test-topic',
                message: {
                    id: uuidv4(),
                    payload: { test: 'after-unsubscribe' }
                },
                request_id: uuidv4()
            };

            const initialEventCount = subscriber1.messageLog.filter(msg => msg.type === 'event').length;
            this.sendWsMessage(publisher, testPublishMsg);
            await this.wait(500);

            const finalEventCount = subscriber1.messageLog.filter(msg => msg.type === 'event').length;
            this.recordTest('WebSocket Unsubscribe Verification',
                initialEventCount === finalEventCount,
                `Events before: ${initialEventCount}, after: ${finalEventCount}`);

            // Test 11: Invalid message format
            publisher.send('invalid json');
            await this.wait(500);

            const formatError = publisher.messageLog.some(msg =>
                msg.type === 'error' && msg.error.code === 'BAD_REQUEST'
            );
            this.recordTest('WebSocket Invalid JSON', formatError, 'Invalid JSON handling');

            // Test 12: Missing required fields
            const invalidMsg = {
                type: 'subscribe'
                // Missing topic and client_id
            };
            this.sendWsMessage(subscriber1, invalidMsg);
            await this.wait(500);

            const validationError = subscriber1.messageLog.some(msg =>
                msg.type === 'error' && msg.error.code === 'BAD_REQUEST'
            );
            this.recordTest('WebSocket Validation', validationError, 'Missing required fields');

            // Test 13: Invalid message type
            const unknownTypeMsg = {
                type: 'unknown-type',
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber1, unknownTypeMsg);
            await this.wait(500);

            const unknownTypeError = subscriber1.messageLog.some(msg =>
                msg.type === 'error' &&
                msg.request_id === unknownTypeMsg.request_id &&
                msg.error.code === 'BAD_REQUEST'
            );
            this.recordTest('WebSocket Unknown Message Type', unknownTypeError,
                `Request ID: ${unknownTypeMsg.request_id}`);

        } catch (error) {
            this.recordTest('WebSocket Operations', false, `Error: ${error.message}`);
        } finally {
            // Clean up WebSocket connections
            if (publisher) publisher.close();
            if (subscriber1) subscriber1.close();
            if (subscriber2) subscriber2.close();
            if (subscriber3) subscriber3.close();
        }
    }

    // Test topic deletion and notifications
    async testTopicDeletion() {
        this.log('='.repeat(60), 'INFO');
        this.log('TESTING TOPIC DELETION AND NOTIFICATIONS', 'INFO');
        this.log('='.repeat(60), 'INFO');

        let subscriber;

        try {
            // Create subscriber
            subscriber = await this.createWebSocketClient('DeletionTestSubscriber');
            await this.wait(500);

            // Subscribe to topic
            const subscribeMsg = {
                type: 'subscribe',
                topic: 'test-topic',
                client_id: subscriber.clientId,
                request_id: uuidv4()
            };
            this.sendWsMessage(subscriber, subscribeMsg);
            await this.wait(500);

            // Delete topic via REST API
            const deleteResult = await this.makeRequest('/topics/test-topic', 'DELETE');
            this.recordTest('DELETE /topics/{name}',
                deleteResult.status === 200 &&
                deleteResult.data.status === 'deleted',
                `Status: ${deleteResult.status}`
            );

            await this.wait(500);

            // Check if subscriber received topic deletion notification
            const deletionNotification = subscriber.messageLog.some(msg =>
                msg.type === 'info' &&
                msg.topic === 'test-topic' &&
                msg.msg === 'topic_deleted'
            );
            this.recordTest('Topic Deletion Notification', deletionNotification,
                'Subscriber notified of topic deletion');

            // Test deleting non-existent topic
            const deleteNonExistent = await this.makeRequest('/topics/non-existent', 'DELETE');
            this.recordTest('DELETE /topics/{name} (not found)',
                deleteNonExistent.status === 404,
                `Status: ${deleteNonExistent.status}`);

        } catch (error) {
            this.recordTest('Topic Deletion Tests', false, `Error: ${error.message}`);
        } finally {
            if (subscriber) subscriber.close();
        }
    }

    // Test edge cases and error conditions
    async testEdgeCases() {
        this.log('='.repeat(60), 'INFO');
        this.log('TESTING EDGE CASES AND ERROR CONDITIONS', 'INFO');
        this.log('='.repeat(60), 'INFO');

        // Test invalid UUID in message
        let testClient;
        try {
            testClient = await this.createWebSocketClient('EdgeCaseClient');
            await this.wait(500);

            // Create topic for testing
            await this.makeRequest('/topics', 'POST', { name: 'edge-test-topic' });

            // Subscribe first
            const subscribeMsg = {
                type: 'subscribe',
                topic: 'edge-test-topic',
                client_id: testClient.clientId,
                request_id: uuidv4()
            };
            this.sendWsMessage(testClient, subscribeMsg);
            await this.wait(500);

            // Test invalid UUID in publish message
            const invalidUuidMsg = {
                type: 'publish',
                topic: 'edge-test-topic',
                message: {
                    id: 'invalid-uuid-format',
                    payload: { test: 'data' }
                },
                request_id: uuidv4()
            };
            this.sendWsMessage(testClient, invalidUuidMsg);
            await this.wait(500);

            const uuidError = testClient.messageLog.some(msg =>
                msg.type === 'error' &&
                msg.error.code === 'BAD_REQUEST' &&
                msg.error.message.includes('UUID')
            );
            this.recordTest('Invalid UUID Validation', uuidError, 'UUID format validation');

            // Test empty payload
            const emptyPayloadMsg = {
                type: 'publish',
                topic: 'edge-test-topic',
                // Missing message field
                request_id: uuidv4()
            };
            this.sendWsMessage(testClient, emptyPayloadMsg);
            await this.wait(500);

            const emptyPayloadError = testClient.messageLog.some(msg =>
                msg.type === 'error' &&
                msg.request_id === emptyPayloadMsg.request_id &&
                msg.error.code === 'BAD_REQUEST'
            );
            this.recordTest('Empty Payload Validation', emptyPayloadError,
                `Request ID: ${emptyPayloadMsg.request_id}`);

        } catch (error) {
            this.recordTest('Edge Cases', false, `Error: ${error.message}`);
        } finally {
            if (testClient) testClient.close();
            // Clean up test topic
            try {
                await this.makeRequest('/topics/edge-test-topic', 'DELETE');
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    // Print final test results
    printTestResults() {
        this.log('='.repeat(80), 'INFO');
        this.log('TEST RESULTS SUMMARY', 'INFO');
        this.log('='.repeat(80), 'INFO');

        const total = this.testResults.passed + this.testResults.failed;
        const passRate = total > 0 ? ((this.testResults.passed / total) * 100).toFixed(1) : 0;

        this.log(`Total Tests: ${total}`, 'INFO');
        this.log(`Passed: ${this.testResults.passed}`, 'SUCCESS');
        this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed > 0 ? 'ERROR' : 'INFO');
        this.log(`Pass Rate: ${passRate}%`, passRate === '100.0' ? 'SUCCESS' : 'ERROR');

        if (this.testResults.failed > 0) {
            this.log('\nFAILED TESTS:', 'ERROR');
            this.testResults.tests
                .filter(test => !test.passed)
                .forEach(test => {
                    this.log(`  ❌ ${test.testName}: ${test.details}`, 'ERROR');
                });
        }

        this.log('='.repeat(80), 'INFO');
    }

    // Main test runner
    async run() {
        this.log('🚀 Starting Comprehensive PubSub System Tests', 'INFO');
        this.log(`Base URL: ${this.baseUrl}`, 'INFO');
        this.log(`WebSocket URL: ${this.wsUrl}`, 'INFO');

        try {
            await this.testRestEndpoints();
            await this.wait(1000);

            await this.testWebSocketOperations();
            await this.wait(1000);

            await this.testTopicDeletion();
            await this.wait(1000);

            await this.testEdgeCases();

        } catch (error) {
            this.log(`Test suite failed: ${error.message}`, 'ERROR');
        }

        this.printTestResults();

        // Exit with appropriate code
        setTimeout(() => {
            process.exit(this.testResults.failed > 0 ? 1 : 0);
        }, 2000);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const tester = new ComprehensiveTest();
    tester.run().catch(console.error);
}

export { ComprehensiveTest };
