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

function parseArgs(args) {
    let customUrl = null;
    let filePaths = [];
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-u') {
            if (i + 1 >= args.length) {
                throw new Error('Missing URL after -u flag');
            }
            customUrl = args[i + 1];
            i++;
        } else {
            filePaths.push(args[i]);
        }
    }
    
    return { customUrl, filePaths };
}

function getAllFilesFromDirectory(dirPath) {
    const files = [];
    const entries = fs.readdirSync(dirPath);
    
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = fs.statSync(fullPath);
        
        if (stat.isFile()) {
            const ext = path.extname(entry).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mp4', '.mov'].includes(ext)) {
                files.push(fullPath);
            }
        }
    }
    
    return files;
}

async function main() {
    try {
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.error('Usage: node trigger_workflow.js [-u <url>] <file1|directory> [file2] [file3] [file4] [file5]');
            console.error('Examples:');
            console.error('  node scripts/trigger_workflow.js path/to/image1.jpg path/to/image2.png');
            console.error('  node scripts/trigger_workflow.js path/to/images/');
            console.error('  node scripts/trigger_workflow.js -u https://custom.url/receive-email path/to/image1.jpg');
            console.error('Note: Accepts files or a directory with image/video files');
            process.exit(1);
        }
        
        const { customUrl, filePaths } = parseArgs(args);
        
        if (filePaths.length === 0) {
            console.error('Error: No files or directory specified');
            process.exit(1);
        }
        
        let allFiles = [];
        
        for (const filePath of filePaths) {
            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    const dirFiles = getAllFilesFromDirectory(filePath);
                    allFiles.push(...dirFiles);
                } else if (stat.isFile()) {
                    allFiles.push(filePath);
                }
            } else {
                throw new Error(`File or directory not found: ${filePath}`);
            }
        }
        
        if (allFiles.length === 0) {
            console.error('Error: No valid image/video files found');
            process.exit(1);
        }
        
        if (allFiles.length > 5) {
            console.error(`Error: Too many files (${allFiles.length}). Maximum 5 files allowed.`);
            process.exit(1);
        }
        
        const RECEIVE_EMAIL_URL = customUrl || getEnvVar('RECEIVE_EMAIL_URL');
        const WEBHOOK_SECRET = getEnvVar('WEBHOOK_SECRET');
        
        console.log(`Processing ${allFiles.length} files:`);
        allFiles.forEach((file, i) => {
            console.log(`  ${i + 1}. ${file}`);
        });
        console.log(`Target URL: ${RECEIVE_EMAIL_URL}`);
        console.log('');
        
        const senderEmail = 'test@example.com';
        const results = [];
        
        for (let i = 0; i < allFiles.length; i++) {
            const filePath = allFiles[i];
            console.log(`Processing file ${i + 1}/${allFiles.length}: ${path.basename(filePath)}`);
            
            try {
                const attachment = await loadFile(filePath);
                const result = await sendAttachmentsToEndpoint([attachment], senderEmail, RECEIVE_EMAIL_URL, WEBHOOK_SECRET);
                results.push({ file: filePath, success: true, result });
                console.log(`✅ File ${i + 1} processed successfully`);
            } catch (error) {
                results.push({ file: filePath, success: false, error: error.message });
                console.error(`❌ File ${i + 1} failed: ${error.message}`);
            }
            
            if (i < allFiles.length - 1) {
                console.log('Waiting 1 second before next request...\n');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log('\n📊 Final Results:');
        results.forEach((result, i) => {
            const status = result.success ? '✅' : '❌';
            console.log(`${status} File ${i + 1}: ${path.basename(result.file)}`);
            if (!result.success) {
                console.log(`   Error: ${result.error}`);
            }
        });
        
        const successCount = results.filter(r => r.success).length;
        console.log(`\n${successCount}/${allFiles.length} files processed successfully`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { sendAttachmentsToEndpoint, loadFile, generateSignature };
