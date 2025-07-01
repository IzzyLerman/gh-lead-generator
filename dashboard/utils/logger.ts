/**
 * Structured logging utility for Next.js Dashboard
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

class DashboardLogger {
  private config: LoggerConfig;
  private sessionId: string;

  constructor(config: LoggerConfig) {
    this.config = config;
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private sanitizeData(data: any): any {
    if (!data) return data;
    
    // Deep clone to avoid modifying original
    const sanitized = JSON.parse(JSON.stringify(data, this.jsonReplacer));
    
    return this.recursiveSanitize(sanitized);
  }

  // Custom JSON replacer to handle circular references and functions
  private jsonReplacer(key: string, value: any): any {
    // Skip function properties
    if (typeof value === 'function') {
      return '[Function]';
    }
    
    // Handle DOM elements
    if (value && typeof value === 'object' && value.nodeType) {
      return '[DOM Element]';
    }
    
    // Handle React components/elements
    if (value && typeof value === 'object' && value.$$typeof) {
      return '[React Element]';
    }
    
    return value;
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
      } else if (this.isSupabaseField(lowerKey)) {
        sanitized[key] = this.sanitizeSupabaseData(value);
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
      'private_key', 'signature', 'access_token', 'refresh_token',
      'session_token', 'jwt', 'bearer'
    ];
    
    return sensitiveFields.some(field => key.includes(field));
  }

  private isEmailField(key: string): boolean {
    return key.includes('email') || key.includes('sender');
  }

  private isSupabaseField(key: string): boolean {
    return key.includes('supabase') || key.includes('sb-') || key.includes('auth');
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

  private sanitizeSupabaseData(value: any): any {
    if (this.config.environment === 'production') {
      if (typeof value === 'string' && value.includes('supabase')) {
        return '[SUPABASE_URL]';
      }
    }
    return value;
  }

  private sanitizeValue(value: any): any {
    if (typeof value === 'string') {
      // Redact potential phone numbers in production
      if (this.config.environment === 'production') {
        value = value.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
      }
      
      // Redact potential URLs with sensitive info
      if (this.config.environment === 'production') {
        value = value.replace(/https?:\/\/[^\s]+/g, '[URL]');
      }
    }
    
    return value;
  }

  private sanitizeError(error: any): any {
    if (!error) return error;

    const sanitized: any = {
      name: error.name,
      message: error.message,
    };

    // Include stack trace only in development
    if (this.config.environment === 'development' && error.stack) {
      sanitized.stack = error.stack;
    }

    // Sanitize additional error properties
    Object.keys(error).forEach(key => {
      if (!['name', 'message', 'stack'].includes(key)) {
        sanitized[key] = this.recursiveSanitize(error[key]);
      }
    });

    return sanitized;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): any {
    const timestamp = new Date().toISOString();
    const sanitizedContext = this.config.environment === 'production' 
      ? this.sanitizeData(context)
      : context;

    return {
      timestamp,
      level,
      service: this.config.service,
      sessionId: this.sessionId,
      message,
      ...(sanitizedContext && Object.keys(sanitizedContext).length > 0 ? { context: sanitizedContext } : {})
    };
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('DEBUG')) {
      const logData = this.formatMessage('DEBUG', message, context);
      console.log(`[${logData.timestamp}] [DEBUG] [${this.config.service}] ${message}`, logData.context || '');
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('INFO')) {
      const logData = this.formatMessage('INFO', message, context);
      console.log(`[${logData.timestamp}] [INFO] [${this.config.service}] ${message}`, logData.context || '');
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('WARN')) {
      const logData = this.formatMessage('WARN', message, context);
      console.warn(`[${logData.timestamp}] [WARN] [${this.config.service}] ${message}`, logData.context || '');
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('ERROR')) {
      const logData = this.formatMessage('ERROR', message, context);
      console.error(`[${logData.timestamp}] [ERROR] [${this.config.service}] ${message}`, logData.context || '');
    }
  }

  // Convenience method for logging errors with proper sanitization
  logError(error: Error | any, message?: string, context?: LogContext): void {
    const sanitizedError = this.sanitizeError(error);
    const errorContext = {
      ...context,
      error: sanitizedError
    };

    this.error(message || 'An error occurred', errorContext);
  }

  // Convenience method for logging component lifecycle
  component(componentName: string, action: string, details?: LogContext): void {
    this.debug(`Component ${componentName}: ${action}`, details);
  }

  // Convenience method for logging user interactions
  interaction(action: string, details?: LogContext): void {
    this.info(`User interaction: ${action}`, details);
  }

  // Convenience method for logging API calls
  api(method: string, endpoint: string, details?: LogContext): void {
    const sanitizedDetails = {
      ...details,
      endpoint: this.config.environment === 'production' 
        ? endpoint.replace(/\/[^\/]+$/, '/[ID]') 
        : endpoint
    };
    this.info(`API ${method.toUpperCase()}: ${endpoint}`, sanitizedDetails);
  }

  // Method to create child logger with additional context
  child(additionalContext: LogContext): DashboardLogger {
    const childLogger = new DashboardLogger(this.config);
    childLogger.sessionId = this.sessionId;
    
    // Override methods to include additional context
    const originalMethods = ['debug', 'info', 'warn', 'error'];
    originalMethods.forEach(method => {
      const originalMethod = childLogger[method as keyof DashboardLogger] as Function;
      (childLogger as any)[method] = (message: string, context?: LogContext) => {
        const mergedContext = { ...additionalContext, ...context };
        originalMethod.call(childLogger, message, mergedContext);
      };
    });

    return childLogger;
  }
}

/**
 * Create a logger instance for Dashboard/Frontend
 */
export function createLogger(service: string = 'dashboard', customConfig?: Partial<LoggerConfig>): DashboardLogger {
  // Auto-detect environment
  const environment: Environment = (() => {
    const env = (process.env.NODE_ENV || 
                 process.env.NEXT_PUBLIC_ENVIRONMENT || 
                 'development').toLowerCase();
    
    if (env.includes('prod')) return 'production';
    if (env.includes('test')) return 'test';
    return 'development';
  })();

  // Set log level based on environment
  const level: LogLevel = (() => {
    const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL?.toUpperCase() as LogLevel;
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
      return envLevel;
    }
    
    // Default levels by environment
    switch (environment) {
      case 'production': return 'WARN'; // More restrictive for frontend
      case 'test': return 'ERROR';
      default: return 'DEBUG';
    }
  })();

  const config: LoggerConfig = {
    level,
    environment,
    service,
    ...customConfig
  };

  return new DashboardLogger(config);
}

// Export convenience function for quick logging setup
export const log = {
  create: createLogger,
  
  // Static methods for quick access (uses default config)
  debug: (message: string, context?: LogContext) => createLogger('dashboard').debug(message, context),
  info: (message: string, context?: LogContext) => createLogger('dashboard').info(message, context),
  warn: (message: string, context?: LogContext) => createLogger('dashboard').warn(message, context),
  error: (message: string, context?: LogContext) => createLogger('dashboard').error(message, context),
};