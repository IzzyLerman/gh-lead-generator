import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  console.log('Creating Supabase client...')
  console.log('URL exists:', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log('Anon key exists:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  
  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  console.log('Supabase client created successfully')
  return client
}
