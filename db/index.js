const postgres = require('postgres')
const dotenv = require('dotenv')

dotenv.config()

const connectionString = process.env.DATABASE_URL
const sql = postgres(connectionString, {
    ssl: 'require'
})

module.exports = sql
