import { createClient } from '@/utils/supabase/server'
import { Tables } from '@/types/database'

export type CompanyWithContacts = Tables<'companies'> & {
  contacts: Tables<'contacts'>[]
}

export async function fetchCompaniesWithContacts(): Promise<CompanyWithContacts[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('companies')
    .select(`
      *,
      contacts (*)
    `)
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'contacts', ascending: false })

  if (error) {
    console.error('Error fetching companies with contacts:', error)
    throw new Error('Failed to fetch companies data')
  }

  return data as CompanyWithContacts[]
}