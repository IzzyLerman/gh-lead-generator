const AWS = require('aws-sdk-mock');
const fs = require('fs');
const path = require('path');

// Global test setup is now handled in individual test files to ensure proper mock timing

// Clean up jest mocks after each test (AWS mocks are handled by individual test files)
afterEach(() => {
  jest.clearAllMocks();
});

// Test utilities
const testHelpers = {
  /**
   * Create a mock S3 event
   */
  createS3Event(bucketName = 'gh-vehicle-emails', objectKey = 'test-email.eml') {
    return {
      Records: [{
        s3: {
          bucket: { name: bucketName },
          object: { key: objectKey }
        }
      }]
    };
  },

  /**
   * Create a mock Lambda context
   */
  createLambdaContext() {
    return {
      functionName: 'email-processor-test',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:email-processor-test',
      memoryLimitInMB: '256',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/email-processor-test',
      logStreamName: '2024/01/01/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000
    };
  },

  /**
   * Load test fixture file
   */
  loadFixture(filename) {
    const fixturePath = path.join(__dirname, '..', 'fixtures', filename);
    return fs.readFileSync(fixturePath);
  },

  /**
   * Create a mock file attachment
   */
  createMockAttachment(filename = 'test.jpg', contentType = 'image/jpeg', size = 1024) {
    const content = Buffer.alloc(size, 'test-data');
    return {
      filename,
      contentType,
      content,
      size
    };
  },

  /**
   * Mock S3 getObject response
   */
  mockS3GetObject(emailContent) {
    // Restore any existing mock first
    try {
      AWS.restore('S3', 'getObject');
    } catch (e) {
      // Ignore errors if S3 hasn't been mocked yet
    }
    AWS.mock('S3', 'getObject', (params, callback) => {
      callback(null, {
        Body: Buffer.isBuffer(emailContent) ? emailContent : Buffer.from(emailContent)
      });
    });
  },

  /**
   * Create test email content with attachments
   */
  createTestEmail(attachments = []) {
    const boundary = 'test-boundary-123';
    let email = [
      'From: test@example.com',
      'To: processor@example.com',
      'Subject: Test Email with Attachments',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      'This is a test email with attachments.',
      ''
    ];

    attachments.forEach((attachment, index) => {
      email.push(`--${boundary}`);
      email.push(`Content-Type: ${attachment.contentType}`);
      email.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      email.push('Content-Transfer-Encoding: base64');
      email.push('');
      email.push(attachment.content.toString('base64'));
      email.push('');
    });

    email.push(`--${boundary}--`);
    return email.join('\r\n');
  },

  /**
   * Wait for a promise with timeout
   */
  async waitForCondition(conditionFn, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await conditionFn()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }
};

module.exports = testHelpers;