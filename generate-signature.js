#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

// Load environment variables from lambda/.env
require('dotenv').config({ path: './lambda/.env' });

function getEnvVar(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing environment variable: ${key}`);
    }
    return value;
}

async function generateAuthHeaders(attachments) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const webhookSecret = getEnvVar('WEBHOOK_SECRET');
    
    // Recreate the signature payload that matches the receive-email function
    const signaturePayloads = [];
    
    for (const attachment of attachments) {
        // Include filename and content type in signature for security (matching Lambda logic)
        const metaString = `${attachment.name}:${attachment.type}:`;
        const metaBuffer = Buffer.from(metaString, 'utf8');
        const contentBuffer = Buffer.from(attachment.content);
        
        signaturePayloads.push(metaBuffer);
        signaturePayloads.push(contentBuffer);
    }
    
    // Concatenate all payload parts
    const signaturePayload = Buffer.concat(signaturePayloads);
    
    // Create message with signature payload + timestamp (matching receive-email function logic)
    const timestampBuffer = Buffer.from(timestamp, 'utf8');
    const message = Buffer.concat([signaturePayload, timestampBuffer]);
    
    // Generate HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(message);
    const signature = hmac.digest('hex');
    
    return { timestamp, signature };
}

function loadFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath);
    const name = path.basename(filePath);
    const type = mime.lookup(filePath) || 'application/octet-stream';
    
    return { name, type, content };
}

async function main() {
    try {
        const filePaths = process.argv.slice(2);
        
        if (filePaths.length === 0) {
            console.error('Usage: node generate-signature.js <file1> [file2] [file3] ...');
            console.error('Example: node generate-signature.js path/to/image1.jpg path/to/image2.png');
            process.exit(1);
        }
        
        // Load all files
        const attachments = filePaths.map(loadFile);
        
        // Generate auth headers
        const { timestamp, signature } = await generateAuthHeaders(attachments);
        
        // Get the receive email URL from environment
        const receiveEmailUrl = getEnvVar('RECEIVE_EMAIL_URL');
        
        // Generate curl command
        console.log('Generated headers:');
        console.log(`X-Timestamp: ${timestamp}`);
        console.log(`X-Signature: ${signature}`);
        console.log('');
        
        console.log('Complete curl command:');
        console.log('curl -X POST \\');
        console.log(`  "${receiveEmailUrl}" \\`);
        console.log(`  -H "X-Timestamp: ${timestamp}" \\`);
        console.log(`  -H "X-Signature: ${signature}" \\`);
        
        // Add form data for each file
        for (const filePath of filePaths) {
            console.log(`  -F "attachments[]=@${filePath}" \\`);
        }
        
        // Remove the trailing backslash from the last line
        console.log('');
        console.log('Or copy the headers for use in other tools:');
        console.log(`-H "X-Timestamp: ${timestamp}" -H "X-Signature: ${signature}"`);
        
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { generateAuthHeaders, loadFile };