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

const logger = createLogger('zoominfo-service');

export interface CompanySearchInput {
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
}

export class ZoomInfoService implements IZoomInfoService {
  private authManager: ZoomInfoAuthManager;

  constructor(authManager: ZoomInfoAuthManager) {
    this.authManager = authManager;
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

    const searchStrategies = [
      { companyName: input.name },
      { companyName: input.name, state: input.state },
      { companyName: input.name, state: input.state, companyWebsite: input.website },
      { companyName: input.name, state: input.state, companyWebsite: input.website, industryKeywords: input.industries?.join(',') }
    ];

    for (let i = 0; i < searchStrategies.length; i++) {
      const strategy = searchStrategies[i];
      
      const filteredStrategy = Object.fromEntries(
        Object.entries(strategy).filter(([_, value]) => value !== undefined && value !== null && value !== '')
      ) as ZoomInfoCompanySearchParams;

      logger.info(`Attempting search strategy ${i + 1}`, { strategy: filteredStrategy });

      try {
        const result = await this.searchCompanies(filteredStrategy);
        
        if (result.totalResults === 0) {
          logger.info(`Strategy ${i + 1} returned no results, trying next strategy`);
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
        
        logger.info(`Strategy ${i + 1} returned ${result.totalResults} results, trying more specific search`);
        
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

    logger.info('All search strategies exhausted, company not found in ZoomInfo');
    return null;
  }
}