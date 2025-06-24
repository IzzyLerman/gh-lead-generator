const AWS = require('aws-sdk');
const { simpleParser } = require('mailparser');
const FormData = require('form-data');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { fromBuffer: fileTypeFromBuffer } = require('file-type');

// Defer S3 client creation to allow for mocking in tests
let s3 = null;
function getS3Client() {
  if (!s3) {
    s3 = new AWS.S3();
  }
  return s3;
}

const BUCKET_NAME = 'gh-vehicle-emails';

const SUPPORTED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/mov'
];

/**
 * Generate HMAC-SHA256 signature for authentication
 */
function generateSignature(body, timestamp, secret) {
  const message = Buffer.concat([body, Buffer.from(timestamp.toString())]);
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function log(message, ...args) {
  console.log(`[${new Date().toISOString()}] ${message}`, ...args);
}

async function readEmailFromS3(bucketName, key) {
  try {
    log(`Reading email from S3: ${bucketName}/${key}`);
    const params = {
      Bucket: bucketName,
      Key: key
    };
    
    const result = await getS3Client().getObject(params).promise();
    return result.Body;
  } catch (error) {
    log(`Error reading email from S3: ${error.message}`);
    throw error;
  }
}

async function detectFileType(attachment) {
    const detectedType = await fileTypeFromBuffer(attachment.content);
    if (detectedType && detectedType.mime && detectedType.mime !== attachment.contentType) {
        return detectedType.mime;
    }
    return attachment.contentType;
}

async function parseEmailAndExtractAttachments(emailBuffer) {
  try {
    log('Parsing email content');
    const parsed = await simpleParser(emailBuffer);
    
    log(`Email parsed. Subject: ${parsed.subject}`);
    log(`Attachments found: ${parsed.attachments ? parsed.attachments.length : 0}`);
    
    if (!parsed.attachments || parsed.attachments.length === 0) {
      return [];
    }
    
    // Filter for supported image/video types and limit to 5
    const supportedAttachments = [];
    
    for (const attachment of parsed.attachments) {
      if (supportedAttachments.length >= 5) {
        break; // Stop processing once we have 5 supported attachments
      }
      
      // Always run file type detection to handle misidentified files (e.g., HEIC as application/octet-stream)
      let finalMimeType = attachment.contentType?.toLowerCase();
      let isSupported = false;
      
      try {
        const detectedType = await fileTypeFromBuffer(attachment.content);
        if (detectedType?.mime) {
          finalMimeType = detectedType.mime.toLowerCase();
          isSupported = SUPPORTED_TYPES.includes(finalMimeType);
        } else {
          // Fall back to declared content type if file type detection fails
          isSupported = finalMimeType && SUPPORTED_TYPES.includes(finalMimeType);
        }
      } catch (error) {
        log(`Error detecting file type for ${attachment.filename}: ${error.message}`);
        // Fall back to declared content type on error
        isSupported = finalMimeType && SUPPORTED_TYPES.includes(finalMimeType);
      }
      
      if (isSupported) {
        supportedAttachments.push({
          ...attachment,
          contentType: finalMimeType // Use the final determined mime type
        });
      } else if (finalMimeType) {
        log(`Skipping unsupported attachment type: ${finalMimeType}`);
      }
    }
    
    log(`Filtered attachments: ${supportedAttachments.length}`);
    
    return supportedAttachments.map(attachment => ({
      filename: attachment.filename || `attachment_${Date.now()}`,
      contentType: attachment.contentType,
      content: attachment.content
    }));
  } catch (error) {
    log(`Error parsing email: ${error.message}`);
    throw error;
  }
}

async function sendAttachmentsToEndpoint(attachments, receiveEmailUrl, webhookSecret) {
  try {
    if (attachments.length === 0) {
      log('No attachments to send');
      return { success: true, message: 'No attachments found', processed: 0 };
    }
    
    log(`Sending ${attachments.length} attachments to ${receiveEmailUrl}`);
    
    const formData = new FormData();
    let headers = {};
    
    // Combined loop for FormData creation and signature payload building
    if (webhookSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      let signaturePayload = Buffer.alloc(0);
      
      attachments.forEach((attachment, index) => {
        log(`Adding attachment ${index + 1}: ${attachment.filename} (${attachment.contentType})`);
        
        // Add to FormData
        formData.append('attachments[]', attachment.content, {
          filename: attachment.filename,
          contentType: attachment.contentType
        });
        
        // Build signature payload at the same time
        const metaBuffer = Buffer.from(`${attachment.filename}:${attachment.contentType}:`);
        signaturePayload = Buffer.concat([signaturePayload, metaBuffer, attachment.content]);
      });
      
      const signature = generateSignature(signaturePayload, timestamp, webhookSecret);
      headers['X-Timestamp'] = timestamp.toString();
      headers['X-Signature'] = signature;
      log('Added authentication headers');
    } else {
      // No webhook secret, just build FormData
      attachments.forEach((attachment, index) => {
        log(`Adding attachment ${index + 1}: ${attachment.filename} (${attachment.contentType})`);
        formData.append('attachments[]', attachment.content, {
          filename: attachment.filename,
          contentType: attachment.contentType
        });
      });
    }
	    
    const response = await fetch(receiveEmailUrl, {
      method: 'POST',
      body: formData,
      headers: {
        ...headers,
      },
      timeout: 60000 // 60 second timeout for file uploads
    });
    
    log(`Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      log(`Error response: ${errorText}`);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    log('Successfully sent attachments:', result);
    
    return { success: true, result };
  } catch (error) {
    log(`Error sending attachments: ${error.message}`);
    throw error;
  }
}

exports.handler = async (event, context) => {
  log('Lambda function started');
  log('Event:', JSON.stringify(event, null, 2));

  
  try {
    const RECEIVE_EMAIL_URL = process.env.RECEIVE_EMAIL_URL;
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    
    if (!RECEIVE_EMAIL_URL) {
      throw new Error('RECEIVE_EMAIL_URL environment variable is required');
    }
    
    if (event.Records && event.Records[0] && event.Records[0].s3) {
      const s3Event = event.Records[0].s3;
      const bucketName = s3Event.bucket.name;
      const objectKey = decodeURIComponent(s3Event.object.key.replace(/\+/g, ' '));
      
      log(`Processing S3 object: ${bucketName}/${objectKey}`);
      
      const emailBuffer = await readEmailFromS3(bucketName, objectKey);
      
      const attachments = await parseEmailAndExtractAttachments(emailBuffer);
      
      if (attachments.length === 0) {
        log('No supported attachments found in email');
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'No supported attachments found',
            processed: 0
          })
        };
      }
      
      const result = await sendAttachmentsToEndpoint(attachments, RECEIVE_EMAIL_URL, WEBHOOK_SECRET);
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Email processed successfully',
          processed: attachments.length,
          result: result.result
        })
      };
    }
    
    // Handle direct invocation for testing
    if (event.testEmail) {
      const emailBuffer = Buffer.from(event.testEmail, 'base64');
      const attachments = await parseEmailAndExtractAttachments(emailBuffer);
      const result = await sendAttachmentsToEndpoint(attachments, RECEIVE_EMAIL_URL, WEBHOOK_SECRET);
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Test email processed',
          processed: attachments.length,
          result: result.result
        })
      };
    }
    
    throw new Error('Invalid event format. Expected S3 event or testEmail property.');
    
  } catch (error) {
    log(`Lambda execution error: ${error.message}`);
    log('Stack trace:', error.stack);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

module.exports.resetS3Client = function() {
  s3 = null;
}
