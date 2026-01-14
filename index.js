const express = require('express');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// Debug: Print environment variables
console.log('=== Environment Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('REDIS_URL exists:', !!process.env.REDIS_URL);
console.log('REDIS_PRIVATE_URL exists:', !!process.env.REDIS_PRIVATE_URL);
console.log('REDIS_PUBLIC_URL exists:', !!process.env.REDIS_PUBLIC_URL);
console.log('========================');

// Get Redis URL from environment
const redisUrl = process.env.REDIS_URL ||
    process.env.REDIS_PRIVATE_URL ||
    process.env.REDIS_PUBLIC_URL;

if (!redisUrl) {
    console.error('❌ ERROR: No Redis URL found in environment variables!');
    console.error('Please add Redis service to Railway and check variables.');
    process.exit(1);
}

console.log('Using Redis URL:', redisUrl.replace(/:[^:]*@/, ':****@')); // Hide password

// Redis connection
const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

connection.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
});

connection.on('connect', () => {
    console.log('✅ Connected to Redis successfully');
});

// Create queue
const taskQueue = new Queue('tasks', { connection });
const embeddingQueue = new Queue('process-embedding', { connection });
const similarityQueue = new Queue('similarity-search', { connection });
// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'Server is running' });
});

// Endpoint to add task to queue
app.post('/api/task', async (req, res) => {
    try {
        const job = await taskQueue.add('process-task', {
            data: req.body,
            timestamp: new Date().toISOString()
        });

        res.status(200).json({
            success: true,
            message: 'Task added to queue',
            jobId: job.id
        });
    } catch (error) {
        console.error('Error adding task to queue:', error);
        res.status(500).json({ error: 'Failed to add task to queue' });
    }
});

app.post('/api/embedding', async (req, res) => {
    const { username } = req.body;
    try {
        const job = await embeddingQueue.add('process-embedding', {
            username: username,  // Changed from data: username
            timestamp: new Date().toISOString()
        });
        res.status(200).json({
            success: true,
            message: 'Embedding added to queue',
            jobId: job.id
        });
    } catch (error) {
        console.error('Error adding embedding to queue:', error);
        res.status(500).json({ error: 'Failed to add embedding to queue' });
    }
});


// Endpoint to check job status
app.get('/api/task/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await taskQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const state = await job.getState();
        const progress = job.progress;

        res.status(200).json({
            jobId: job.id,
            state,
            progress,
            data: job.data,
            result: job.returnvalue
        });
    } catch (error) {
        console.error('Error fetching job status:', error);
        res.status(500).json({ error: 'Failed to fetch job status' });
    }
});




// Endpoint for similarity search
app.post('/api/similarity-search', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({
            error: 'Username is required'
        });
    }

    console.log('🔍 Received similarity search request');
    console.log('Username:', username);

    try {
        const job = await similarityQueue.add('search', {
            username: username,
            timestamp: new Date().toISOString()
        });

        console.log('✅ Similarity search job added to queue:', job.id);

        res.status(200).json({
            success: true,
            message: 'Similarity search job added to queue',
            jobId: job.id
        });
    } catch (error) {
        console.error('❌ Error adding similarity search to queue:', error);
        res.status(500).json({ error: 'Failed to add similarity search to queue' });
    }
});

// Endpoint to get similarity search results
app.get('/api/similarity-search/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await similarityQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const state = await job.getState();

        if (state === 'completed') {
            res.status(200).json({
                jobId: job.id,
                state,
                results: job.returnvalue
            });
        } else if (state === 'failed') {
            res.status(500).json({
                jobId: job.id,
                state,
                error: job.failedReason
            });
        } else {
            res.status(200).json({
                jobId: job.id,
                state,
                message: 'Job is still processing'
            });
        }
    } catch (error) {
        console.error('Error fetching similarity search status:', error);
        res.status(500).json({ error: 'Failed to fetch job status' });
    }
});









const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await taskQueue.close();
    await embeddingQueue.close();
    await similarityQueue.close();
    await connection.quit();
    process.exit(0);
});