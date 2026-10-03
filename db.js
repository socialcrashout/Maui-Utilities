const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');

function sanitizeMongoURI(uri) {
    if (!uri) return uri;

    // Drop anything before the scheme (e.g. a doubled "MONGO_URI=")
    const start = uri.search(/mongodb(\+srv)?:\/\//);
    if (start > 0) uri = uri.slice(start);

    // Trim whitespace and stray quotes
    uri = uri.trim().replace(/^["']|["']$/g, '').trim();

    const m = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/);
    if (!m) return uri;
    const [, prefix, rest] = m;

    // Split at the LAST '@' so an unencoded '@' in the password stays in the password
    const atIndex = rest.lastIndexOf('@');
    if (atIndex === -1) return uri;

    const creds = rest.slice(0, atIndex);
    const hostAndQuery = rest.slice(atIndex + 1);

    const colon = creds.indexOf(':');
    if (colon === -1) return uri;

    const user = creds.slice(0, colon);
    const pass = creds.slice(colon + 1);
    if (!pass) return uri;

    // Already encoded and no raw special chars left -> leave it alone
    if (/%[0-9A-Fa-f]{2}/.test(pass) && !/[@:/?#\[\]]/.test(pass)) return uri;

    return `${prefix}${user}:${encodeURIComponent(pass)}@${hostAndQuery}`;
}

let mongoClient = null;
let db = null;

async function connectDB() {
    if (db) return db;

    const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'discordbot';
    const rawUri = process.env.MONGO_URI;
    if (!rawUri) throw new Error('MONGO_URI not provided (is dotenv loaded?)');

    const uri = sanitizeMongoURI(rawUri);

    // Temporary debug (password masked): remove once it connects
    console.log('URI (masked):', uri.replace(/\/\/([^:]+):.*@/, '//$1:***@'));

    if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
        throw new Error('MONGO_URI must start with mongodb:// or mongodb+srv:// - check your .env');
    }
    if (uri.includes('CLUSTERHOST')) {
        throw new Error('MONGO_URI still has the CLUSTERHOST placeholder - use your real Atlas host');
    }

    try {
        mongoClient = new MongoClient(uri);
        await mongoClient.connect();
        db = mongoClient.db(MONGO_DB_NAME);
        console.log('✅ MongoDB (native) connected');

        await mongoose.connect(uri, { dbName: MONGO_DB_NAME });
        console.log('✅ Mongoose connected');

        return db;
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
        throw err;
    }
}

function getDB() {
    if (!db) throw new Error('Database not connected yet! Call connectDB() first.');
    return db;
}

function getClient() {
    return mongoClient;
}

module.exports = { connectDB, getDB, getClient };