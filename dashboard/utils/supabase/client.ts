import { createBrowserClient } from '@supabase/ssr'
import { createLogger } from '@/utils/logger'

export function createClient() {
  const logger = createLogger('supabase-client')
  
  logger.debug('Creating Supabase client', {
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  })
  
  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  logger.debug('Supabase client created successfully')
  return client
}
