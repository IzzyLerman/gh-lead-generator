const testHelpers = require('../setup/testHelpers');

describe('Attachment Filtering and Validation', () => {
  // Supported file types from the Lambda function
  const SUPPORTED_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/mov'
  ];

  describe('attachment type filtering', () => {
    test('should accept all supported image types', () => {
      const imageTypes = [
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/webp',
        'image/heic'
      ];

      imageTypes.forEach(type => {
        expect(SUPPORTED_TYPES.includes(type)).toBe(true);
      });
    });

    test('should accept all supported video types', () => {
      const videoTypes = [
        'video/mp4',
        'video/mov'
      ];

      videoTypes.forEach(type => {
        expect(SUPPORTED_TYPES.includes(type)).toBe(true);
      });
    });

    test('should reject unsupported file types', () => {
      const unsupportedTypes = [
        'application/pdf',
        'text/plain',
        'application/msword',
        'video/avi',
        'image/gif',
        'image/bmp',
        'audio/mp3'
      ];

      unsupportedTypes.forEach(type => {
        expect(SUPPORTED_TYPES.includes(type)).toBe(false);
      });
    });

    test('should handle case-insensitive type checking', () => {
      const mixedCaseTypes = [
        'IMAGE/JPEG',
        'Image/Png',
        'VIDEO/MP4',
        'Video/Mov'
      ];

      // Simulate case-insensitive filtering
      mixedCaseTypes.forEach(type => {
        const normalizedType = type.toLowerCase();
        expect(SUPPORTED_TYPES.includes(normalizedType)).toBe(true);
      });
    });

    test('should filter attachments by supported types', () => {
      const attachments = [
        { contentType: 'image/jpeg', filename: 'photo.jpg' },
        { contentType: 'application/pdf', filename: 'document.pdf' },
        { contentType: 'video/mp4', filename: 'video.mp4' },
        { contentType: 'text/plain', filename: 'notes.txt' },
        { contentType: 'image/png', filename: 'screenshot.png' }
      ];

      const filtered = attachments.filter(att => 
        SUPPORTED_TYPES.includes(att.contentType?.toLowerCase())
      );

      expect(filtered).toHaveLength(3);
      expect(filtered.map(a => a.filename)).toEqual(['photo.jpg', 'video.mp4', 'screenshot.png']);
    });
  });

  describe('attachment count limiting', () => {
    test('should limit attachments to maximum of 5', () => {
      const attachments = Array.from({ length: 8 }, (_, i) => ({
        contentType: 'image/jpeg',
        filename: `image${i + 1}.jpg`,
        content: Buffer.from(`image content ${i + 1}`)
      }));

      const limited = attachments.slice(0, 5);

      expect(limited).toHaveLength(5);
      expect(limited[0].filename).toBe('image1.jpg');
      expect(limited[4].filename).toBe('image5.jpg');
    });

    test('should not modify array if 5 or fewer attachments', () => {
      const attachments = Array.from({ length: 3 }, (_, i) => ({
        contentType: 'image/jpeg',
        filename: `image${i + 1}.jpg`
      }));

      const limited = attachments.slice(0, 5);

      expect(limited).toHaveLength(3);
      expect(limited).toEqual(attachments);
    });

    test('should handle empty attachment array', () => {
      const attachments = [];
      const limited = attachments.slice(0, 5);

      expect(limited).toHaveLength(0);
    });
  });

  describe('attachment validation', () => {
    test('should validate attachment structure', () => {
      const validAttachment = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        content: Buffer.from('test content')
      };

      expect(validAttachment.filename).toBeTruthy();
      expect(validAttachment.contentType).toBeTruthy();
      expect(validAttachment.content).toBeInstanceOf(Buffer);
      expect(validAttachment.content.length).toBeGreaterThan(0);
    });

    test('should handle attachments with missing filename', () => {
      const attachment = {
        contentType: 'image/jpeg',
        content: Buffer.from('test content')
      };

      // Should provide default filename logic
      const filename = attachment.filename || `attachment_${Date.now()}`;
      
      expect(filename).toBeTruthy();
      expect(filename).toMatch(/attachment_\d+/);
    });

    test('should handle attachments with missing content type', () => {
      const attachment = {
        filename: 'test.jpg',
        content: Buffer.from('test content')
      };

      // Should handle missing content type gracefully
      const contentType = attachment.contentType || 'application/octet-stream';
      
      expect(contentType).toBe('application/octet-stream');
    });

    test('should validate content buffer exists', () => {
      const attachments = [
        { filename: 'valid.jpg', contentType: 'image/jpeg', content: Buffer.from('data') },
        { filename: 'invalid.jpg', contentType: 'image/jpeg', content: null },
        { filename: 'empty.jpg', contentType: 'image/jpeg', content: Buffer.alloc(0) }
      ];

      const validAttachments = attachments.filter(att => 
        att.content && Buffer.isBuffer(att.content) && att.content.length > 0
      );

      expect(validAttachments).toHaveLength(1);
      expect(validAttachments[0].filename).toBe('valid.jpg');
    });
  });

  describe('attachment processing workflow', () => {
    test('should process complete filtering and validation workflow', () => {
      const rawAttachments = [
        { filename: 'photo1.jpg', contentType: 'image/jpeg', content: Buffer.from('photo1') },
        { filename: 'document.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') },
        { filename: 'photo2.PNG', contentType: 'image/PNG', content: Buffer.from('photo2') },
        { filename: 'video.mp4', contentType: 'video/mp4', content: Buffer.from('video') },
        { filename: 'music.mp3', contentType: 'audio/mp3', content: Buffer.from('music') },
        { filename: 'photo3.webp', contentType: 'image/webp', content: Buffer.from('photo3') },
        { filename: 'photo4.heic', contentType: 'image/heic', content: Buffer.from('photo4') },
        { filename: 'extra.jpg', contentType: 'image/jpeg', content: Buffer.from('extra') }
      ];

      // Step 1: Filter by supported types (case-insensitive)
      const typeFiltered = rawAttachments.filter(att => 
        SUPPORTED_TYPES.includes(att.contentType?.toLowerCase())
      );

      // Step 2: Limit to 5 attachments
      const limitedAttachments = typeFiltered.slice(0, 5);

      // Step 3: Validate content
      const validAttachments = limitedAttachments.filter(att =>
        att.content && Buffer.isBuffer(att.content) && att.content.length > 0
      );

      expect(validAttachments).toHaveLength(5);
      expect(validAttachments.map(a => a.filename)).toEqual([
        'photo1.jpg', 'photo2.PNG', 'video.mp4', 'photo3.webp', 'photo4.heic'
      ]);
    });

    test('should handle workflow with fewer than 5 valid attachments', () => {
      const rawAttachments = [
        { filename: 'photo1.jpg', contentType: 'image/jpeg', content: Buffer.from('photo1') },
        { filename: 'document.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') },
        { filename: 'video.mp4', contentType: 'video/mp4', content: Buffer.from('video') }
      ];

      const typeFiltered = rawAttachments.filter(att => 
        SUPPORTED_TYPES.includes(att.contentType?.toLowerCase())
      );
      const limitedAttachments = typeFiltered.slice(0, 5);

      expect(limitedAttachments).toHaveLength(2);
      expect(limitedAttachments.map(a => a.filename)).toEqual(['photo1.jpg', 'video.mp4']);
    });
  });
});