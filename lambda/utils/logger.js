/**
 * Structured logging utility for AWS Lambda
 * Provides environment-aware logging with automatic sanitization
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class LambdaLogger {
  constructor(config) {
    this.config = config;
    this.correlationId = this.generateCorrelationId();
  }

  generateCorrelationId() {
    return Math.random().toString(36).substring(2, 10);
  }

  shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  sanitizeData(data) {
    if (!data) return data;
    
    // Deep clone to avoid modifying original
    const sanitized = JSON.parse(JSON.stringify(data));
    
    return this.recursiveSanitize(sanitized);
  }

  recursiveSanitize(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeValue(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.recursiveSanitize(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Skip sensitive fields entirely
      if (this.isSensitiveField(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else if (this.isEmailField(lowerKey)) {
        sanitized[key] = this.sanitizeEmail(value);
      } else if (this.isAWSMetadata(lowerKey)) {
        sanitized[key] = this.sanitizeAWSMetadata(value);
      } else if (typeof value === 'object') {
        sanitized[key] = this.recursiveSanitize(value);
      } else {
        sanitized[key] = this.sanitizeValue(value);
      }
    }
    
    return sanitized;
  }

  isSensitiveField(key) {
    const sensitiveFields = [
      'password', 'secret', 'key', 'token', 'authorization',
      'credit_card', 'ssn', 'social_security', 'api_key',
      'private_key', 'signature', 'content', 'body', 'message',
      'accesskeyid', 'secretaccesskey', 'sessiontoken'
    ];
    
    return sensitiveFields.some(field => key.includes(field));
  }

  isEmailField(key) {
    return key.includes('email') || key.includes('sender');
  }

  isAWSMetadata(key) {
    return key.includes('aws') || key.includes('s3') || key.includes('lambda');
  }

  sanitizeEmail(email) {
    if (!email || typeof email !== 'string') return email;
    
    if (this.config.environment === 'production') {
      const atIndex = email.indexOf('@');
      if (atIndex > 0) {
        const domain = email.substring(atIndex);
        return `***${domain}`;
      }
    }
    
    return email; // Show full email in development
  }

  sanitizeAWSMetadata(value) {
    if (this.config.environment === 'production') {
      if (typeof value === 'string') {
        // Sanitize ARNs, bucket names, etc.
        return value.replace(/arn:aws:[^:]+:[^:]*:[^:]*:/g, 'arn:aws:***:***:***:');
      }
    }
    return value;
  }

  sanitizeValue(value) {
    if (typeof value === 'string') {
      // Redact potential phone numbers in production
      if (this.config.environment === 'production') {
        return value.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
      }
    }
    
    return value;
  }

  sanitizeEvent(event) {
    if (!event) return event;

    const sanitized = { ...event };

    // Always sanitize Records for S3 events
    if (sanitized.Records) {
      sanitized.Records = sanitized.Records.map(record => ({
        eventVersion: record.eventVersion,
        eventSource: record.eventSource,
        eventName: record.eventName,
        awsRegion: record.awsRegion,
        s3: record.s3 ? {
          bucket: {
            name: this.config.environment === 'production' ? '[BUCKET]' : record.s3.bucket?.name,
            arn: this.config.environment === 'production' ? '[ARN]' : record.s3.bucket?.arn
          },
          object: {
            key: record.s3.object?.key ? 
              (this.config.environment === 'production' ? 
                record.s3.object.key.replace(/[^\/]+$/, '[FILENAME]') : 
                record.s3.object.key) : undefined,
            size: record.s3.object?.size
          }
        } : undefined
      }));
    }

    // Remove any other sensitive data
    return this.recursiveSanitize(sanitized);
  }

  formatMessage(level, message, context) {
    const timestamp = new Date().toISOString();
    const sanitizedContext = this.config.environment === 'production' 
      ? this.sanitizeData(context)
      : context;

    const logEntry = {
      timestamp,
      level,
      service: this.config.service,
      correlationId: this.correlationId,
      message,
      ...(sanitizedContext && Object.keys(sanitizedContext).length > 0 ? { context: sanitizedContext } : {})
    };

    return JSON.stringify(logEntry);
  }

  debug(message, context) {
    if (this.shouldLog('DEBUG')) {
      console.log(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message, context) {
    if (this.shouldLog('INFO')) {
      console.log(this.formatMessage('INFO', message, context));
    }
  }

  warn(message, context) {
    if (this.shouldLog('WARN')) {
      console.warn(this.formatMessage('WARN', message, context));
    }
  }

  error(message, context) {
    if (this.shouldLog('ERROR')) {
      console.error(this.formatMessage('ERROR', message, context));
    }
  }

  // Convenience method for logging errors with stack traces
  logError(error, message, context) {
    const errorContext = {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        ...(this.config.environment === 'development' ? { stack: error.stack } : {})
      }
    };

    this.error(message || 'An error occurred', errorContext);
  }

  // Convenience method for logging Lambda events safely
  logEvent(event, message = 'Lambda event received') {
    const sanitizedEvent = this.sanitizeEvent(event);
    this.info(message, { event: sanitizedEvent });
  }

  // Convenience method for logging processing steps
  step(step, details) {
    this.info(`Step: ${step}`, details);
  }

  // Method to create child logger with additional context
  child(additionalContext) {
    const childLogger = new LambdaLogger(this.config);
    childLogger.correlationId = this.correlationId;
    
    // Override methods to include additional context
    const originalMethods = ['debug', 'info', 'warn', 'error'];
    originalMethods.forEach(method => {
      const originalMethod = childLogger[method];
      childLogger[method] = (message, context) => {
        const mergedContext = { ...additionalContext, ...context };
        originalMethod.call(childLogger, message, mergedContext);
      };
    });

    return childLogger;
  }
}

/**
 * Create a logger instance for Lambda functions
 */
function createLogger(service = 'lambda', customConfig = {}) {
  // Auto-detect environment
  const environment = (() => {
    const env = (process.env.NODE_ENV || 
                 process.env.ENVIRONMENT || 
                 process.env.STAGE || 
                 'development').toLowerCase();
    
    if (env.includes('prod')) return 'production';
    if (env.includes('test')) return 'test';
    return 'development';
  })();

  // Set log level based on environment
  const level = (() => {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
      return envLevel;
    }
    
    // Default levels by environment
    switch (environment) {
      case 'production': return 'INFO';
      case 'test': return 'WARN';
      default: return 'DEBUG';
    }
  })();

  const config = {
    level,
    environment,
    service,
    ...customConfig
  };

  return new LambdaLogger(config);
}

// Export convenience function for quick logging setup
const log = {
  create: createLogger,
  
  // Static methods for quick access (uses default config)
  debug: (message, context) => createLogger('lambda').debug(message, context),
  info: (message, context) => createLogger('lambda').info(message, context),
  warn: (message, context) => createLogger('lambda').warn(message, context),
  error: (message, context) => createLogger('lambda').error(message, context),
};

module.exports = {
  createLogger,
  log,
  LambdaLogger
};