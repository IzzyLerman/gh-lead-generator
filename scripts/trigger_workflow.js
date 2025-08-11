#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const { fromBuffer: fileTypeFromBuffer } = require(path.join(__dirname, '../lambda/node_modules/file-type'));

require('dotenv').config({ path: path.join(__dirname, '../lambda/.env') });

const FormData = require(path.join(__dirname, '../lambda/node_modules/form-data'));
const fetch = require(path.join(__dirname, '../lambda/node_modules/node-fetch'));

function getEnvVar(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing environment variable: ${key}. Check lambda/.env file.`);
    }
    return value;
}

function generateSignature(body, timestamp, secret) {
    const message = Buffer.concat([body, Buffer.from(timestamp.toString())]);
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

async function loadFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    let contentType = mime.lookup(filePath) || 'application/octet-stream';
    
    try {
        const detectedType = await fileTypeFromBuffer(content);
        if (detectedType?.mime) {
            contentType = detectedType.mime.toLowerCase();
        } else {
            // Fall back to extension-based detection if no type detected
            const fileName = filename.toLowerCase();
            if (fileName.endsWith('.heic') || fileName.endsWith('.heif')) {
                contentType = 'image/heic';
            } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
                contentType = 'image/jpeg';
            } else if (fileName.endsWith('.png')) {
                contentType = 'image/png';
            } else if (fileName.endsWith('.webp')) {
                contentType = 'image/webp';
            } else if (fileName.endsWith('.mp4')) {
                contentType = 'video/mp4';
            } else if (fileName.endsWith('.mov')) {
                contentType = 'video/mov';
            }
        }
    } catch (error) {
        console.warn(`File type detection failed for ${filename}, using extension-based fallback`);
        
        // Fall back to extension-based detection on error
        const fileName = filename.toLowerCase();
        if (fileName.endsWith('.heic') || fileName.endsWith('.heif')) {
            contentType = 'image/heic';
        } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
            contentType = 'image/jpeg';
        } else if (fileName.endsWith('.png')) {
            contentType = 'image/png';
        } else if (fileName.endsWith('.webp')) {
            contentType = 'image/webp';
        } else if (fileName.endsWith('.mp4')) {
            contentType = 'video/mp4';
        } else if (fileName.endsWith('.mov')) {
            contentType = 'video/mov';
        }
    }
    
    return { filename, contentType, content };
}

async function sendAttachmentsToEndpoint(attachments, senderEmail, receiveEmailUrl, webhookSecret) {
    const formData = new FormData();
    
    formData.append('sender_email', senderEmail);
    
    const timestamp = Math.floor(Date.now() / 1000);
    let signaturePayload = Buffer.from(senderEmail);
    
    attachments.forEach((attachment) => {
        formData.append('attachments[]', attachment.content, {
            filename: attachment.filename,
            contentType: attachment.contentType
        });
        
        const metaBuffer = Buffer.from(`${attachment.filename}:${attachment.contentType}:`);
        signaturePayload = Buffer.concat([signaturePayload, metaBuffer, attachment.content]);
    });
    
    const signature = generateSignature(signaturePayload, timestamp, webhookSecret);
    
    const headers = {
        'X-Timestamp': timestamp.toString(),
        'X-Signature': signature
    };
    
    console.log(`Sending ${attachments.length} attachments to ${receiveEmailUrl}`);
    console.log(`Headers: X-Timestamp: ${timestamp}, X-Signature: ${signature}`);
    console.log('Files:');
    attachments.forEach((att, i) => {
        console.log(`  ${i + 1}. ${att.filename} (${att.contentType}, ${att.content.length} bytes)`);
    });
    console.log('');
    
    const response = await fetch(receiveEmailUrl, {
        method: 'POST',
        body: formData,
        headers: headers,
        timeout: 60000
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
    }
    
    const result = await response.json();
    return result;
}

async function main() {
    try {
        const args = process.argv.slice(2);
        
        if (args.length === 0 || args.length > 5) {
            console.error('Usage: node trigger_workflow.js <image1> [image2] [image3] [image4] [image5]');
            console.error('Example: node scripts/trigger_workflow.js path/to/image1.jpg path/to/image2.png');
            console.error('Note: Accepts 1-5 image files');
            process.exit(1);
        }
        
        const RECEIVE_EMAIL_URL = getEnvVar('RECEIVE_EMAIL_URL');
        const WEBHOOK_SECRET = getEnvVar('WEBHOOK_SECRET');
        
        const attachments = await Promise.all(args.map(loadFile));
        
        const senderEmail = 'test@example.com';
        
        const result = await sendAttachmentsToEndpoint(attachments, senderEmail, RECEIVE_EMAIL_URL, WEBHOOK_SECRET);
        
        console.log('✅ Success! Response:');
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { sendAttachmentsToEndpoint, loadFile, generateSignature };
