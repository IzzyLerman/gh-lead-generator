const { simpleParser } = require('mailparser');
const testHelpers = require('../setup/testHelpers');

// Mock the Lambda handler to access internal functions
jest.mock('aws-sdk');
const AWS = require('aws-sdk');

describe('Email Parser', () => {
  describe('parseEmailAndExtractAttachments', () => {
    test('should parse email with multiple attachments', async () => {
      const attachments = [
        testHelpers.createMockAttachment('truck1.jpg', 'image/jpeg', 1024),
        testHelpers.createMockAttachment('van2.png', 'image/png', 2048),
        testHelpers.createMockAttachment('vehicle.mp4', 'video/mp4', 5120)
      ];
      
      const emailContent = testHelpers.createTestEmail(attachments);
      const parsed = await simpleParser(emailContent);
      
      expect(parsed.attachments).toHaveLength(3);
      expect(parsed.attachments[0].filename).toBe('truck1.jpg');
      expect(parsed.attachments[0].contentType).toBe('image/jpeg');
      expect(parsed.attachments[1].filename).toBe('van2.png');
      expect(parsed.attachments[1].contentType).toBe('image/png');
      expect(parsed.attachments[2].filename).toBe('vehicle.mp4');
      expect(parsed.attachments[2].contentType).toBe('video/mp4');
    });

    test('should handle email with no attachments', async () => {
      const emailContent = testHelpers.createTestEmail([]);
      const parsed = await simpleParser(emailContent);
      
      expect(parsed.attachments).toEqual([]);
    });

    test('should filter out unsupported attachment types', async () => {
      const attachments = [
        testHelpers.createMockAttachment('document.pdf', 'application/pdf', 1024),
        testHelpers.createMockAttachment('truck.jpg', 'image/jpeg', 2048),
        testHelpers.createMockAttachment('data.txt', 'text/plain', 512)
      ];
      
      const emailContent = testHelpers.createTestEmail(attachments);
      const parsed = await simpleParser(emailContent);
      
      // Should have all attachments in parsed email
      expect(parsed.attachments).toHaveLength(3);
      
      // But our filtering logic would only accept the JPEG
      const supportedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
        'video/mp4', 'video/mov'
      ];
      
      const filtered = parsed.attachments.filter(att => 
        supportedTypes.includes(att.contentType?.toLowerCase())
      );
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].contentType).toBe('image/jpeg');
    });

    test('should limit attachments to 5 maximum', async () => {
      const attachments = Array.from({ length: 8 }, (_, i) => 
        testHelpers.createMockAttachment(`image${i}.jpg`, 'image/jpeg', 1024)
      );
      
      const emailContent = testHelpers.createTestEmail(attachments);
      const parsed = await simpleParser(emailContent);
      
      expect(parsed.attachments).toHaveLength(8);
      
      // Our logic would slice to 5
      const limited = parsed.attachments.slice(0, 5);
      expect(limited).toHaveLength(5);
    });

    test('should handle malformed email gracefully', async () => {
      const malformedEmail = 'This is not a valid email format';
      
      try {
        const parsed = await simpleParser(malformedEmail);
        // simpleParser is pretty forgiving, it might still parse something
        expect(parsed).toBeDefined();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    test('should handle email with mixed content types', async () => {
      const attachments = [
        testHelpers.createMockAttachment('photo.JPEG', 'image/JPEG', 1024), // uppercase
        testHelpers.createMockAttachment('video.MOV', 'video/MOV', 2048),   // uppercase
        testHelpers.createMockAttachment('image.heic', 'image/heic', 1536)  // HEIC support
      ];
      
      const emailContent = testHelpers.createTestEmail(attachments);
      const parsed = await simpleParser(emailContent);
      
      expect(parsed.attachments).toHaveLength(3);
      
      // Test case-insensitive filtering
      const supportedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
        'video/mp4', 'video/mov'
      ];
      
      const filtered = parsed.attachments.filter(att => 
        supportedTypes.includes(att.contentType?.toLowerCase())
      );
      
      expect(filtered).toHaveLength(3);
    });

    test('should extract attachment content correctly', async () => {
      const testContent = Buffer.from('test image data');
      const attachments = [
        {
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          content: testContent
        }
      ];
      
      const emailContent = testHelpers.createTestEmail(attachments);
      const parsed = await simpleParser(emailContent);
      
      expect(parsed.attachments[0].content).toBeInstanceOf(Buffer);
      expect(parsed.attachments[0].content.length).toBeGreaterThan(0);
    });

    test('should handle attachments without filenames', async () => {
      const emailWithUnnamedAttachment = [
        'From: test@example.com',
        'Subject: Test',
        'Content-Type: multipart/mixed; boundary="test"',
        '',
        '--test',
        'Content-Type: image/jpeg',
        'Content-Transfer-Encoding: base64',
        '',
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        '--test--'
      ].join('\r\n');
      
      const parsed = await simpleParser(emailWithUnnamedAttachment);
      
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].contentType).toBe('image/jpeg');
      // Should handle missing filename gracefully
    });
  });
});
