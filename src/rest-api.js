import express from 'express';

/**
 * REST API routes for topic management and observability
 */
export function createRestAPI(pubsub) {
    const router = express.Router();

    // Middleware for JSON parsing
    router.use(express.json());

    // Error handling middleware
    const asyncHandler = (fn) => (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };

    /**
     * POST /topics - Create a new topic
     */
    router.post('/topics', asyncHandler(async (req, res) => {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({
                error: 'Missing required field: name'
            });
        }

        if (typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                error: 'Topic name must be a non-empty string'
            });
        }

        try {
            const result = pubsub.createTopic(name.trim());
            res.status(201).json(result);
        } catch (error) {
            if (error.message === 'TOPIC_ALREADY_EXISTS') {
                return res.status(409).json({
                    error: 'Topic already exists'
                });
            }
            throw error;
        }
    }));

    /**
     * DELETE /topics/:name - Delete a topic
     */
    router.delete('/topics/:name', asyncHandler(async (req, res) => {
        const { name } = req.params;

        if (!name) {
            return res.status(400).json({
                error: 'Missing topic name in path'
            });
        }

        try {
            const result = pubsub.deleteTopic(name);
            res.status(200).json(result);
        } catch (error) {
            if (error.message === 'TOPIC_NOT_FOUND') {
                return res.status(404).json({
                    error: 'Topic not found'
                });
            }
            throw error;
        }
    }));

    /**
     * GET /topics - List all topics with subscriber counts
     */
    router.get('/topics', asyncHandler(async (req, res) => {
        const result = pubsub.getTopics();
        res.status(200).json(result);
    }));

    /**
     * GET /health - Get system health information
     */
    router.get('/health', asyncHandler(async (req, res) => {
        const health = pubsub.getHealth();
        res.status(200).json(health);
    }));

    /**
     * GET /stats - Get detailed system statistics
     */
    router.get('/stats', asyncHandler(async (req, res) => {
        const stats = pubsub.getStats();
        res.status(200).json(stats);
    }));

    /**
     * Error handling middleware
     */
    router.use((error, req, res, next) => {
        console.error('REST API Error:', error);

        // Don't expose internal error details in production
        const isDevelopment = process.env.NODE_ENV !== 'production';

        res.status(500).json({
            error: 'Internal server error',
            ...(isDevelopment && { details: error.message })
        });
    });

    /**
     * 404 handler for unknown routes
     */
    router.use('*', (req, res) => {
        res.status(404).json({
            error: 'Endpoint not found'
        });
    });

    return router;
}

/**
 * Create Express app with REST API
 */
export function createExpressApp(pubsub) {
    const app = express();

    // Security and parsing middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    // Request logging middleware
    app.use((req, res, next) => {
        const start = Date.now();

        res.on('finish', () => {
            const duration = Date.now() - start;
            console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
        });

        next();
    });

    // Health check endpoint at root
    app.get('/', (req, res) => {
        res.json({
            service: 'Plivo PubSub System',
            status: 'running',
            version: '1.0.0',
            endpoints: {
                websocket: '/ws',
                rest: {
                    topics: '/topics',
                    health: '/health',
                    stats: '/stats'
                }
            }
        });
    });

    // Mount REST API routes
    app.use('/', createRestAPI(pubsub));

    // Global error handler
    app.use((error, req, res, next) => {
        console.error('Express Error:', error);

        if (res.headersSent) {
            return next(error);
        }

        const isDevelopment = process.env.NODE_ENV !== 'production';

        res.status(500).json({
            error: 'Internal server error',
            ...(isDevelopment && { details: error.message })
        });
    });

    return app;
}
