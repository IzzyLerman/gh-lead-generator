const AWS = require('aws-sdk');
const { simpleParser } = require('mailparser');
const FormData = require('form-data');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { fromBuffer: fileTypeFromBuffer } = require('file-type');
// Conditional import for local vs production environment
const loggerPath =  './utils/logger';
const { createLogger } = require(loggerPath);

// Defer S3 client creation to allow for mocking in tests
let s3 = null;
function getS3Client() {
  if (!s3) {
    s3 = new AWS.S3({
      region: 'us-east-1'
    });
  }
  return s3;
}

const BUCKET_NAME = 'gh-vehicle-emails';

const SUPPORTED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/mov', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-flv', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/ogg', 'video/avi', 'video/mpeg', 'video/x-m4v', 'video/x-matroska'
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
    //const result  = {Body: "none"};
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
    
    
    // Extract sender email address
    const senderEmail = parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown';
    
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
      logger.info(`File type: ${finalMimeType}`)
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

        logger.info('Comprehensive attachment debug', {
          filename: attachment.filename,
          declaredType: attachment.contentType,
          finalMimeType: finalMimeType,
          finalMimeTypeLength: finalMimeType?.length,
          finalMimeTypeBytes: finalMimeType ? Array.from(finalMimeType).map(c =>
        c.charCodeAt(0)) : null,
          isSupported: isSupported,
          supportedTypesIncludes: SUPPORTED_TYPES.includes(finalMimeType),
          supportedTypesArray: SUPPORTED_TYPES,
          fileTypeDetected: detectedType?.mime,
          contentLength: attachment.content?.length
        });
      } catch (error) {
        logger.warn('Error detecting file type', { 
          filename: attachment.filename,
          declaredType: attachment.contentType,
          error: error.message
        });
        
      
      

        

        
      
        // Fall back to declared content type on error
        isSupported = finalMimeType && SUPPORTED_TYPES.includes(finalMimeType);

        
      
      }
      logger.info('About to check isSupported', {
        isSupported,
        filename: attachment.filename,
        willBeAdded: isSupported === true
      });
      if (isSupported) {
        logger.info('Attachment being skipped - detailed info', {
          filename: attachment.filename,
          finalMimeType,
          isSupported,
          supportedTypesCheck: SUPPORTED_TYPES.includes(finalMimeType),
          supportedTypesArray: SUPPORTED_TYPES
        });
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
    
    const formData = new FormData();
    let headers = {};
    
    // Add sender email to form data
    formData.append('sender_email', senderEmail);
    
    // Combined loop for FormData creation and signature payload building
    if (webhookSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      let signaturePayload = Buffer.from(senderEmail); // Include sender email in signature
      
      attachments.forEach((attachment, index) => {
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
      
      logger.info('Processing S3 event', { bucket: bucketName, key: objectKey });
      
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

