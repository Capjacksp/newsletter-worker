const { Worker } = require('bullmq');
const Redis = require('ioredis');
const sql = require('./db/index.js');
const OpenAI = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Debug: Print environment variables
console.log('=== Worker Environment Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('REDIS_URL exists:', !!process.env.REDIS_URL);
console.log('REDIS_PRIVATE_URL exists:', !!process.env.REDIS_PRIVATE_URL);
console.log('REDIS_PUBLIC_URL exists:', !!process.env.REDIS_PUBLIC_URL);
console.log('================================');

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
    console.error('❌ Worker Redis connection error:', err.message);
});

connection.on('connect', () => {
    console.log('✅ Worker connected to Redis successfully');
});

// Create worker to process tasks
const worker = new Worker('tasks', async (job) => {
    console.log(`Processing job ${job.id}`);
    console.log('Job data:', job.data);
    const { username, prompt, model } = job.data.data;
    console.log("processing job for user ", username, model)
    const users = await sql`SELECT * FROM users WHERE username = ${username}`;
    try {

        const results = [];

        // Loop through each article and call LLM
        for (const article of users[0].articles.data) {
            try {
                // Construct the prompt with article data and user's input_prompt
                const articlePrompt = `${prompt}
                 Article Data:
                 Title: ${article.title}
                 Source: ${article.source}
                 Full Article Text: ${article.full_article_text.slice(0, 4000)}
                 ${users[0].output_prompt}`;
                console.log("processing article ", article.title);
                // Call OpenAI for this article
                const completion = await openai.chat.completions.create({
                    model: model || 'gpt-5-nano',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a strategic analyst. Return only valid JSON.'
                        },
                        {
                            role: 'user',
                            content: articlePrompt
                        }
                    ],
                });

                const generatedContent = JSON.parse(completion.choices[0].message.content);
                generatedContent.source = article.source;
                generatedContent.title = article.title;
                generatedContent.link = article.link;
                generatedContent.publish_date = article.publish_date;
                results.push(generatedContent);

            } catch (articleErr) {
                console.error(`Error processing article: ${article.title}`, articleErr);
            }
        }

        // Format the results for newsletter column
        const newsletterData = {
            "0": {
                "data": results
            }
        };

        // Update the database with the results and set is_generating to false
        await sql`
            UPDATE users 
            SET newsletter = ${newsletterData}, is_generating = false 
            WHERE username = ${users[0].username}
        `;


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