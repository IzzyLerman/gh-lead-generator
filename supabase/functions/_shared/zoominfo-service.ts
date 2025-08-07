import { ZoomInfoAuthManager } from './zoominfo-auth.ts';
import { 
  getCompanyFromZoomInfo, 
  getContactFromCompany, 
  enrichCompanyContact,
  type ZoomInfoCompanySearchParams,
  type ZoomInfoCompanySearchResponse,
  type ZoomInfoContactSearchParams,
  type ZoomInfoContactSearchResponse,
  type ZoomInfoEnrichContactParams,
  type ZoomInfoEnrichContactResponse
} from './zoominfo-api.ts';
import { createLogger } from './logger.ts';
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './database.types.ts';

const logger = createLogger('zoominfo-service');

export interface CompanySearchInput {
  id?: string;
  name: string;
  state?: string;
  website?: string;
  industries?: string[];
}

export interface IZoomInfoService {
  searchCompanies(params: ZoomInfoCompanySearchParams): Promise<ZoomInfoCompanySearchResponse>;
  searchContacts(params: ZoomInfoContactSearchParams): Promise<ZoomInfoContactSearchResponse>;
  enrichContacts(params: ZoomInfoEnrichContactParams): Promise<ZoomInfoEnrichContactResponse>;
  progressiveCompanySearch(input: CompanySearchInput): Promise<ZoomInfoCompanySearchResponse | null>;
  extractCompanyZipCode(companyId: string): Promise<{ hasLocation: boolean; companyZip: string | null }>;
}

export class ZoomInfoService implements IZoomInfoService {
  private authManager: ZoomInfoAuthManager;
  private supabase: SupabaseClient<Database>;

  constructor(authManager: ZoomInfoAuthManager, supabase: SupabaseClient<Database>) {
    this.authManager = authManager;
    this.supabase = supabase;
  }

  async searchCompanies(params: ZoomInfoCompanySearchParams): Promise<ZoomInfoCompanySearchResponse> {
    const token = await this.authManager.getValidToken();
    return await getCompanyFromZoomInfo(params, token);
  }

  async searchContacts(params: ZoomInfoContactSearchParams): Promise<ZoomInfoContactSearchResponse> {
    const token = await this.authManager.getValidToken();
    return await getContactFromCompany(params, token);
  }

  async enrichContacts(params: ZoomInfoEnrichContactParams): Promise<ZoomInfoEnrichContactResponse> {
    const token = await this.authManager.getValidToken();
    return await enrichCompanyContact(params, token);
  }

  async progressiveCompanySearch(input: CompanySearchInput): Promise<ZoomInfoCompanySearchResponse | null> {
    logger.info('Starting progressive company search', { companyName: input.name });

    let searchStrategies: any[] = [
      { companyName: input.name }
    ];

    if (input.website) {
        searchStrategies.push({companyWebsite: input.website });
    }

    if (input.id) {
      const { hasLocation, companyZip } = await this.extractCompanyZipCode(input.id);
      if (hasLocation && companyZip) { 
        searchStrategies = searchStrategies.concat([
          { companyName: input.name, zipCode: companyZip, zipCodeRadiusMiles: "100" },
          { companyName: input.name, zipCode: companyZip, zipCodeRadiusMiles: "50" }
        ]);
      }
    }

    let lastMultipleResultsResponse: ZoomInfoCompanySearchResponse | null = null;

    for (let i = 0; i < searchStrategies.length; i++) {
      const strategy = searchStrategies[i];
      
      const filteredStrategy = Object.fromEntries(
        Object.entries(strategy).filter(([_, value]) => value !== undefined && value !== null && value !== '')
      ) as ZoomInfoCompanySearchParams;

      logger.info(`Attempting search strategy ${i + 1}`, { strategy: filteredStrategy });

      try {
        const result = await this.searchCompanies(filteredStrategy);
        
        if (result.totalResults === 0) {
          logger.info(`Strategy ${i + 1} returned no results`);
          
          if (lastMultipleResultsResponse) {
            logger.info('Using top result from previous search that had multiple results', {
              companyId: lastMultipleResultsResponse.data[0].id,
              companyName: lastMultipleResultsResponse.data[0].name
            });
            return lastMultipleResultsResponse;
          }
          
          logger.info('Trying next strategy');
          continue;
        }
        
        if (result.totalResults === 1) {
          logger.info(`Strategy ${i + 1} found exactly one result, using it`, { 
            companyId: result.data[0].id,
            companyName: result.data[0].name 
          });
          return result;
        }
        
        if (result.totalResults > 1 && i === searchStrategies.length - 1) {
          logger.info(`Final strategy returned multiple results (${result.totalResults}), taking first result`, {
            companyId: result.data[0].id,
            companyName: result.data[0].name
          });
          return result;
        }
        
        if (result.totalResults > 1) {
          logger.info(`Strategy ${i + 1} returned ${result.totalResults} results, storing as fallback and trying more specific search`);
          lastMultipleResultsResponse = result;
        }
        
      } catch (error) {
        logger.error(`Strategy ${i + 1} failed`, { 
          error: error instanceof Error ? error.message : String(error),
          strategy: filteredStrategy 
        });
        
        if (i === searchStrategies.length - 1) {
          throw error;
        }
      }
    }

    if (lastMultipleResultsResponse) {
      logger.info('All strategies exhausted, using stored result from previous search with multiple results', {
        companyId: lastMultipleResultsResponse.data[0].id,
        companyName: lastMultipleResultsResponse.data[0].name
      });
      return lastMultipleResultsResponse;
    }

    logger.info('All search strategies exhausted, company not found in ZoomInfo');
    return null;
  }

  async extractCompanyZipCode(companyId: string): Promise<{ hasLocation: boolean; companyZip: string | null }> {
    logger.info('Extracting zip code for company', { companyId });
    
    try {
      const { data, error } = await this.supabase
        .from('vehicle-photos')
        .select('location')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Error querying vehicle-photos', { companyId, error });
        return { hasLocation: false, companyZip: null };
      }

      if (!data || data.length === 0) {
        logger.info('No vehicle photos found for company', { companyId });
        return { hasLocation: false, companyZip: null };
      }

      for (const photo of data) {
        if (!photo.location) {
          continue;
        }

        const locationParts = photo.location.split(',').map(part => part.trim());
        
        for (let i = 1; i < locationParts.length; i++) {
          const part = locationParts[i];
          
          if (/^\d{5}$/.test(part)) {
            logger.info('Found 5-digit zip code', { companyId, zipCode: part });
            return { hasLocation: true, companyZip: part };
          }
          
          if (/^\d{5}-\d{4}$/.test(part)) {
            logger.info('Found extended zip code', { companyId, zipCode: part });
            return { hasLocation: true, companyZip: part };
          }
        }
      }

      logger.info('No valid zip code found in vehicle photo locations', { companyId });
      return { hasLocation: false, companyZip: null };
    } catch (error) {
      logger.error('Error extracting company zip code', { companyId, error });
      return { hasLocation: false, companyZip: null };
    }
  }
}
