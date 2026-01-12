const { Worker } = require('bullmq');
const Redis = require('ioredis');

// Redis connection - uses Railway Redis URL or local
const redisConfig = process.env.REDIS_URL
    ? process.env.REDIS_URL
    : process.env.REDIS_PRIVATE_URL || 'redis://localhost:6379';

const connection = new Redis(redisConfig, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

connection.on('error', (err) => {
    console.error('Redis connection error:', err);
});

connection.on('connect', () => {
    console.log('✓ Worker connected to Redis successfully');
});

// Create worker to process tasks
const worker = new Worker('tasks', async (job) => {
    console.log(`Processing job ${job.id}`);
    console.log('Job data:', job.data);

    try {
        // Simulate task processing
        await job.updateProgress(10);
        console.log('Task started...');

        // Your actual task logic here
        const { data } = job.data;

        // Simulate some work with progress updates
        for (let i = 1; i <= 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await job.updateProgress(i * 20);
            console.log(`Progress: ${i * 20}%`);
        }

        // Return result
        const result = {
            processed: true,
            originalData: data,
            processedAt: new Date().toISOString(),
            message: 'Task completed successfully'
        };

        console.log(`Job ${job.id} completed`);
        return result;

    } catch (error) {
        console.error(`Job ${job.id} failed:`, error);
        throw error;
    }
}, {
    connection,
    concurrency: 5 // Process up to 5 jobs concurrently
});

// Event listeners
worker.on('completed', (job) => {
    console.log(`✓ Job ${job.id} has completed`);
});

worker.on('failed', (job, err) => {
    console.log(`✗ Job ${job.id} has failed with error: ${err.message}`);
});

worker.on('active', (job) => {
    console.log(`→ Job ${job.id} is now active`);
});

console.log('Worker started and waiting for jobs...');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down worker gracefully');
    await worker.close();
    await connection.quit();
    process.exit(0);
});