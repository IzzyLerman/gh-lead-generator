import { createClient } from '@/utils/supabase/server'
import { Tables } from '@/types/database'

export type CompanyWithContactsAndPhotos = Tables<'companies'> & {
  contacts: Tables<'contacts'>[]
  'vehicle-photos': Tables<'vehicle-photos'>[]
}

export async function fetchCompaniesWithContactsAndPhotos(): Promise<CompanyWithContactsAndPhotos[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('companies')
    .select(`
      *,
      contacts (*),
      "vehicle-photos" (*)
    `)
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'contacts', ascending: false })
    .order('created_at', { referencedTable: 'vehicle-photos', ascending: false })

  if (error) {
    console.error('Error fetching companies with contacts and photos:', error)
    throw new Error('Failed to fetch companies data')
  }

  return data as CompanyWithContactsAndPhotos[]
}

// Keep the original function for backward compatibility
export async function fetchCompaniesWithContacts(): Promise<CompanyWithContactsAndPhotos[]> {
  return fetchCompaniesWithContactsAndPhotos()
}