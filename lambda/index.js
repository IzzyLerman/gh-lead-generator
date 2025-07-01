const AWS = require('aws-sdk');
const { simpleParser } = require('mailparser');
const FormData = require('form-data');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { fromBuffer: fileTypeFromBuffer } = require('file-type');
// Conditional import for local vs production environment
const isProduction = process.env.ENVIRONMENT === 'production';
const loggerPath = isProduction ? '~/utils/logger.js' : './utils/logger';
const { createLogger } = require(loggerPath);

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

// Initialize logger
const logger = createLogger('email-processor');

async function readEmailFromS3(bucketName, key) {
  try {
    logger.info('Reading email from S3', { bucket: bucketName, key });
    const params = {
      Bucket: bucketName,
      Key: key
    };
    
    const result = await getS3Client().getObject(params).promise();
    return result.Body;
  } catch (error) {
    logger.logError(error, 'Error reading email from S3', { bucket: bucketName, key });
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
    logger.step('Parsing email content');
    const parsed = await simpleParser(emailBuffer);
    
    logger.info('Email parsed successfully', { 
      subject: parsed.subject,
      attachmentCount: parsed.attachments ? parsed.attachments.length : 0
    });
    
    // Extract sender email address
    const senderEmail = parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown';
    logger.debug('Extracted sender email', { senderEmail });
    
    if (!parsed.attachments || parsed.attachments.length === 0) {
      return { attachments: [], senderEmail };
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
        logger.warn('Error detecting file type', { 
          filename: attachment.filename,
          declaredType: attachment.contentType,
          error: error.message
        });
        // Fall back to declared content type on error
        isSupported = finalMimeType && SUPPORTED_TYPES.includes(finalMimeType);
      }
      
      if (isSupported) {
        supportedAttachments.push({
          ...attachment,
          contentType: finalMimeType // Use the final determined mime type
        });
      } else if (finalMimeType) {
        logger.debug('Skipping unsupported attachment', { 
          filename: attachment.filename,
          mimeType: finalMimeType
        });
      }
    }
    
    logger.info('Email processing completed', { 
      supportedAttachments: supportedAttachments.length,
      totalProcessed: parsed.attachments ? parsed.attachments.length : 0
    });
    
    return {
      attachments: supportedAttachments.map(attachment => ({
        filename: attachment.filename || `attachment_${Date.now()}`,
        contentType: attachment.contentType,
        content: attachment.content
      })),
      senderEmail
    };
  } catch (error) {
    logger.logError(error, 'Error parsing email');
    throw error;
  }
}

async function sendAttachmentsToEndpoint(attachments, senderEmail, receiveEmailUrl, webhookSecret) {
  try {
    if (attachments.length === 0) {
      logger.info('No attachments to send');
      return { success: true, message: 'No attachments found', processed: 0 };
    }
    
    logger.step('Sending attachments to endpoint', { 
      attachmentCount: attachments.length,
      hasWebhookSecret: !!webhookSecret
    });
    
    const formData = new FormData();
    let headers = {};
    
    // Add sender email to form data
    formData.append('sender_email', senderEmail);
    logger.debug('Added sender email to form data');
    
    // Combined loop for FormData creation and signature payload building
    if (webhookSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      let signaturePayload = Buffer.from(senderEmail); // Include sender email in signature
      
      attachments.forEach((attachment, index) => {
        logger.debug('Adding attachment to form data', {
          index: index + 1,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.content.length
        });
        
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
      logger.debug('Added HMAC authentication headers');
    } else {
      logger.warn('No webhook secret provided - sending without authentication');
      // No webhook secret, just build FormData
      attachments.forEach((attachment, index) => {
        logger.debug('Adding attachment to form data', {
          index: index + 1,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.content.length
        });
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
    
    logger.info('HTTP response received', { status: response.status, ok: response.ok });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('HTTP request failed', { 
        status: response.status,
        statusText: response.statusText,
        responseLength: errorText.length
      });
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    logger.info('Attachments sent successfully', { 
      resultKeys: Object.keys(result),
      success: result.success
    });
    
    return { success: true, result };
  } catch (error) {
    logger.logError(error, 'Error sending attachments');
    throw error;
  }
}

exports.handler = async (event, context) => {
  logger.info('Lambda function started', { 
    requestId: context.awsRequestId,
    functionName: context.functionName,
    remainingTimeMs: context.getRemainingTimeInMillis()
  });
  logger.logEvent(event, 'Processing Lambda event');

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
      
      logger.step('Processing S3 email object', { bucket: bucketName, key: objectKey });
      
      const emailBuffer = await readEmailFromS3(bucketName, objectKey);
      
      const { attachments, senderEmail } = await parseEmailAndExtractAttachments(emailBuffer);
      
      if (attachments.length === 0) {
        logger.info('No supported attachments found in email');
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'No supported attachments found',
            processed: 0
          })
        };
      }
      
      const result = await sendAttachmentsToEndpoint(attachments, senderEmail, RECEIVE_EMAIL_URL, WEBHOOK_SECRET);
      
      logger.info('Lambda processing completed successfully', {
        attachmentsProcessed: attachments.length,
        resultSuccess: result.success
      });
      
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
      logger.info('Processing test email from direct invocation');
      const emailBuffer = Buffer.from(event.testEmail, 'base64');
      const { attachments, senderEmail } = await parseEmailAndExtractAttachments(emailBuffer);
      const result = await sendAttachmentsToEndpoint(attachments, senderEmail, RECEIVE_EMAIL_URL, WEBHOOK_SECRET);
      
      logger.info('Test email processing completed', {
        attachmentsProcessed: attachments.length
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Test email processed',
          processed: attachments.length,
          result: result.result
        })
      };
    }
    
    logger.error('Invalid event format - no S3 event or testEmail property found');
    throw new Error('Invalid event format. Expected S3 event or testEmail property.');
    
  } catch (error) {
    logger.logError(error, 'Lambda execution failed', {
      functionName: context.functionName,
      requestId: context.awsRequestId
    });
    
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
