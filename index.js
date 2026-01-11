const express = require('express');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// Redis connection - uses Railway Redis URL or local
const connection = new Redis(process.env.REDIS_URL || {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null
});

// Create queue
const taskQueue = new Queue('tasks', { connection });

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'Server is running' });
});

// Endpoint to add task to queue
app.post('/api/task', async (req, res) => {
    try {
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({ error: 'Data is required' });
        }

        // Add job to queue
        const job = await taskQueue.add('process-task', {
            data,
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await taskQueue.close();
    await connection.quit();
    process.exit(0);
});