import { createClient } from '@/utils/supabase/client'
import { Tables } from '@/types/database'
import { createLogger } from '@/utils/logger'

export type CompanyWithContactsAndPhotos = Tables<'companies'> & {
  contacts: Tables<'contacts'>[]
  'vehicle-photos': Tables<'vehicle-photos'>[]
}

export interface PaginationParams {
  page?: number
  pageSize?: number
}

export interface PaginatedResult<T> {
  data: T[]
  totalCount: number
  totalPages: number
  currentPage: number
  pageSize: number
}

export async function fetchCompaniesWithContactsAndPhotos(
  params: PaginationParams = {}
): Promise<PaginatedResult<CompanyWithContactsAndPhotos>> {
  const supabase = createClient()
  const logger = createLogger('client-utils')
  const { page = 1, pageSize = 10 } = params
  
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // Get total count
  const { count, error: countError } = await supabase
    .from('companies')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    logger.logError(countError, 'Error fetching companies count', { page, pageSize })
    throw new Error('Failed to fetch companies count')
  }

  // Get paginated data
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
    .range(from, to)

  if (error) {
    logger.logError(error, 'Error fetching companies with contacts and photos', { page, pageSize, from, to })
    throw new Error('Failed to fetch companies data')
  }

  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / pageSize)

  return {
    data: data as CompanyWithContactsAndPhotos[],
    totalCount,
    totalPages,
    currentPage: page,
    pageSize
  }
}