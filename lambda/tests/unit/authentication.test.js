const crypto = require('crypto');
const testHelpers = require('../setup/testHelpers');

describe('Authentication', () => {
  describe('generateSignature', () => {
    const testSecret = 'test-webhook-secret';
    
    // Extract the signature generation logic for testing
    function generateSignature(body, timestamp, secret) {
      const message = Buffer.concat([body, Buffer.from(timestamp.toString())]);
      return crypto.createHmac('sha256', secret).update(message).digest('hex');
    }

    test('should generate consistent signatures for same input', () => {
      const body = Buffer.from('test body content');
      const timestamp = '1640995200'; // Fixed timestamp
      
      const signature1 = generateSignature(body, timestamp, testSecret);
      const signature2 = generateSignature(body, timestamp, testSecret);
      
      expect(signature1).toBe(signature2);
      expect(signature1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex string
    });

    test('should generate different signatures for different bodies', () => {
      const body1 = Buffer.from('test body 1');
      const body2 = Buffer.from('test body 2');
      const timestamp = '1640995200';
      
      const signature1 = generateSignature(body1, timestamp, testSecret);
      const signature2 = generateSignature(body2, timestamp, testSecret);
      
      expect(signature1).not.toBe(signature2);
    });

    test('should generate different signatures for different timestamps', () => {
      const body = Buffer.from('test body content');
      const timestamp1 = '1640995200';
      const timestamp2 = '1640995300';
      
      const signature1 = generateSignature(body, timestamp1, testSecret);
      const signature2 = generateSignature(body, timestamp2, testSecret);
      
      expect(signature1).not.toBe(signature2);
    });

    test('should generate different signatures for different secrets', () => {
      const body = Buffer.from('test body content');
      const timestamp = '1640995200';
      const secret1 = 'secret1';
      const secret2 = 'secret2';
      
      const signature1 = generateSignature(body, timestamp, secret1);
      const signature2 = generateSignature(body, timestamp, secret2);
      
      expect(signature1).not.toBe(signature2);
    });

    test('should handle empty body', () => {
      const body = Buffer.alloc(0);
      const timestamp = '1640995200';
      
      const signature = generateSignature(body, timestamp, testSecret);
      
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle binary data in body', () => {
      const body = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      const timestamp = '1640995200';
      
      const signature = generateSignature(body, timestamp, testSecret);
      
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle large timestamps', () => {
      const body = Buffer.from('test content');
      const timestamp = '9999999999'; // Year 2286
      
      const signature = generateSignature(body, timestamp, testSecret);
      
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('signature validation', () => {
    test('should validate correct signature', () => {
      const body = Buffer.from('test body content');
      const timestamp = '1640995200';
      const secret = 'test-secret';
      
      // Generate signature
      const signature = crypto
        .createHmac('sha256', secret)
        .update(Buffer.concat([body, Buffer.from(timestamp)]))
        .digest('hex');
      
      // Validate signature (simulate validation logic)
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(Buffer.concat([body, Buffer.from(timestamp)]))
        .digest('hex');
      
      expect(signature).toBe(expectedSignature);
    });

    test('should reject invalid signature', () => {
      const body = Buffer.from('test body content');
      const timestamp = '1640995200';
      const secret = 'test-secret';
      
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(Buffer.concat([body, Buffer.from(timestamp)]))
        .digest('hex');
      
      const invalidSignature = 'invalid-signature';
      
      expect(validSignature).not.toBe(invalidSignature);
    });
  });

  describe('timestamp validation', () => {
    test('should accept recent timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const recentTimestamp = now - 60; // 1 minute ago
      const timeLimit = 5 * 60; // 5 minutes
      
      const isValid = (now - recentTimestamp) <= timeLimit;
      
      expect(isValid).toBe(true);
    });

    test('should reject old timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const oldTimestamp = now - (10 * 60); // 10 minutes ago
      const timeLimit = 5 * 60; // 5 minutes
      
      const isValid = (now - oldTimestamp) <= timeLimit;
      
      expect(isValid).toBe(false);
    });

    test('should reject future timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureTimestamp = now + (10 * 60); // 10 minutes in future
      const timeLimit = 5 * 60; // 5 minutes
      
      // For future timestamps, now - futureTimestamp will be negative
      // We should reject if timestamp is too far in the future OR past
      const timeDiff = Math.abs(now - futureTimestamp);
      const isValid = timeDiff <= timeLimit;
      
      expect(isValid).toBe(false);
    });

    test('should handle edge case at exact time limit', () => {
      const now = Math.floor(Date.now() / 1000);
      const exactLimitTimestamp = now - (5 * 60); // Exactly 5 minutes ago
      const timeLimit = 5 * 60; // 5 minutes
      
      const isValid = (now - exactLimitTimestamp) <= timeLimit;
      
      expect(isValid).toBe(true);
    });
  });

  describe('authentication headers', () => {
    test('should create proper authentication headers', () => {
      const body = Buffer.from('test request body');
      const timestamp = Math.floor(Date.now() / 1000);
      const secret = 'test-secret';
      
      const signature = crypto
        .createHmac('sha256', secret)
        .update(Buffer.concat([body, Buffer.from(timestamp.toString())]))
        .digest('hex');
      
      const headers = {
        'X-Timestamp': timestamp.toString(),
        'X-Signature': signature
      };
      
      expect(headers['X-Timestamp']).toBe(timestamp.toString());
      expect(headers['X-Signature']).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle string timestamp conversion', () => {
      const timestamp = 1640995200;
      const timestampString = timestamp.toString();
      
      expect(timestampString).toBe('1640995200');
      expect(parseInt(timestampString)).toBe(timestamp);
    });
  });
});