/**
 * Structured logging utility for Supabase Edge Functions
 * Provides environment-aware logging with automatic sanitization
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type Environment = 'development' | 'production' | 'test';

interface LogContext {
  [key: string]: any;
}

interface LoggerConfig {
  level: LogLevel;
  environment: Environment;
  service: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class Logger {
  private config: LoggerConfig;
  private correlationId: string;

  constructor(config: LoggerConfig) {
    this.config = config;
    this.correlationId = crypto.randomUUID().slice(0, 8);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private sanitizeData(data: any): any {
    if (!data) return data;
    
    // Deep clone to avoid modifying original
    const sanitized = JSON.parse(JSON.stringify(data));
    
    return this.recursiveSanitize(sanitized);
  }

  private recursiveSanitize(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeValue(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.recursiveSanitize(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Skip sensitive fields entirely
      if (this.isSensitiveField(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else if (this.isEmailField(lowerKey)) {
        sanitized[key] = this.sanitizeEmail(value as string);
      } else if (typeof value === 'object') {
        sanitized[key] = this.recursiveSanitize(value);
      } else {
        sanitized[key] = this.sanitizeValue(value);
      }
    }
    
    return sanitized;
  }

  private isSensitiveField(key: string): boolean {
    const sensitiveFields = [
      'password', 'secret', 'key', 'token', 'authorization',
      'credit_card', 'ssn', 'social_security', 'api_key',
      'private_key', 'signature', 'content', 'body', 'message'
    ];
    
    return sensitiveFields.some(field => key.includes(field));
  }

  private isEmailField(key: string): boolean {
    return key.includes('email') || key.includes('sender');
  }

  private sanitizeEmail(email: string): string {
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

  private sanitizeValue(value: any): any {
    if (typeof value === 'string') {
      // Redact potential phone numbers in production
      if (this.config.environment === 'production') {
        return value.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
      }
    }
    
    return value;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): any {
    const timestamp = new Date().toISOString();
    const sanitizedContext = context;

    const logEntry = {
      timestamp,
      level,
      service: this.config.service,
      correlationId: this.correlationId,
      message,
      ...(sanitizedContext && Object.keys(sanitizedContext).length > 0 ? { context: sanitizedContext } : {})
    };

    return logEntry;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('DEBUG')) {
      console.log(JSON.stringify(this.formatMessage('DEBUG', message, context)));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('INFO')) {
      console.log(JSON.stringify(this.formatMessage('INFO', message, context)));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('WARN')) {
      console.warn(JSON.stringify(this.formatMessage('WARN', message, context)));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('ERROR')) {
      console.error(JSON.stringify(this.formatMessage('ERROR', message, context)));
    }
  }

  // Convenience method for logging errors with stack traces
  logError(error: Error, message?: string, context?: LogContext): void {
    const errorContext = {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    };

    this.error(message || 'An error occurred', errorContext);
  }

  // Convenience method for logging processing steps
  step(step: string, details?: LogContext): void {
    this.info(`Step: ${step}`, details);
  }

  // Method to create child logger with additional context
  child(additionalContext: LogContext): Logger {
    const childLogger = new Logger(this.config);
    childLogger.correlationId = this.correlationId;
    
    // Override methods to include additional context
    const originalMethods = ['debug', 'info', 'warn', 'error'];
    originalMethods.forEach(method => {
      const originalMethod = childLogger[method as keyof Logger] as Function;
      (childLogger as any)[method] = (message: string, context?: LogContext) => {
        const mergedContext = { ...additionalContext, ...context };
        originalMethod.call(childLogger, message, mergedContext);
      };
    });

    return childLogger;
  }
}

/**
 * Create a logger instance for Edge Functions
 */
export function createLogger(service: string, customConfig?: Partial<LoggerConfig>): Logger {
  // Auto-detect environment
  const environment: Environment = (() => {
    const env = Deno.env.get('ENVIRONMENT')?.toLowerCase() || 
                Deno.env.get('DENO_ENV')?.toLowerCase() || 
                'development';
    
    if (env.includes('prod')) return 'production';
    if (env.includes('test')) return 'test';
    return 'development';
  })();

  // Set log level based on environment
  const level: LogLevel = (() => {
    const envLevel = Deno.env.get('LOG_LEVEL')?.toUpperCase() as LogLevel;
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

  const config: LoggerConfig = {
    level,
    environment,
    service,
    ...customConfig
  };

  return new Logger(config);
}

// Export convenience function for quick logging setup
export const log = {
  create: createLogger,
  
  // Static methods for quick access (uses default config)
  debug: (message: string, context?: LogContext) => createLogger('edge-function').debug(message, context),
  info: (message: string, context?: LogContext) => createLogger('edge-function').info(message, context),
  warn: (message: string, context?: LogContext) => createLogger('edge-function').warn(message, context),
  error: (message: string, context?: LogContext) => createLogger('edge-function').error(message, context),
};