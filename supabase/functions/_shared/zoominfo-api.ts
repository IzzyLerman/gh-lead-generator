import { createLogger } from './logger.ts';

const logger = createLogger('zoominfo-api');

export interface ZoomInfoCompanySearchParams {
  companyName?: string;
  companyWebsite?: string;
  address?: string;
  state?: string;
  country?: string;
  industryKeywords?: string;
  IndustryCodes?: string[];
  sicCodes?: string[];
  naicsCodes?: string[];
  revenueMin?: number;
}

export interface ZoomInfoCompanyData {
  id: number;
  name: string;
}

export interface ZoomInfoCompanySearchResponse {
  maxResults: number;
  totalResults: number;
  currentPage: number;
  data: ZoomInfoCompanyData[];
}

export interface ZoomInfoContactSearchParams {
  companyId: string;
  jobTitle?: string;
  jobFunction?: string;
  managementLevel?: string;
}

export interface ZoomInfoContactData {
  id: number;
  firstName: string;
  lastName: string;
  jobTitle: string;
  jobFunction?: string;
  managementLevel?: string;
  email?: string;
  phone?: string;
  directPhone?: string;
  hasEmail: boolean;
  hasDirect: boolean;
  hasPhone: boolean;
  companyId: number;
  companyName: string;
  zoominfo_id?: number;
  companySicCodes?: string;
  companyNaicsCodes?: string;
}

export interface ZoomInfoContactSearchResponse {
  maxResults: number;
  totalResults: number;
  currentPage: number;
  data: ZoomInfoContactData[];
}

export interface ZoomInfoEnrichContactParams {
  matchPersonInput: Array<{
    personId: number;
  }>;
  outputFields: string[];
}

export interface ZoomInfoEnrichedContactData {
  id: number;
  firstName: string;
  middleName?: string;
  lastName: string;
  email?: string;
  hasCanadianEmail?: boolean;
  phone?: string;
  directPhoneDoNotCall?: boolean;
  street?: string;
  jobTitle?: string;
  jobFunction?: string;
  hashedEmails?: string[];
  managementLevel?: string;
  contactAccuracyScore?: number;
  mobilePhoneDoNotCall?: boolean;
  companyRevenueNumeric?: number;
  companyIndustries?: string[];
  lastUpdatedDate?: string;
  externalUrls?: string[];
  company?: {
    revenueNumeric?: number;
  };
  zoominfo_id?: number;
  companySicCodes?: string;
  companyNaicsCodes?: string;
}

export interface ZoomInfoEnrichContactResponse {
  maxResults: number;
  totalResults: number;
  currentPage: number;
  data: {
    outputFields: string[];
    result: Array<{
      data: ZoomInfoEnrichedContactData[];
    }>;
  };
}

export async function getCompanyFromZoomInfo(
  searchParams: ZoomInfoCompanySearchParams,
  token: string
): Promise<ZoomInfoCompanySearchResponse> {
  logger.info('Searching for company in ZoomInfo', { 
    companyName: searchParams.companyName,
    companyWebsite: searchParams.companyWebsite,
  });

  try {
    const response = await fetch('https://api.zoominfo.com/search/company', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ZoomInfo company search API error', {
        status: response.status,
        statusText: response.statusText,
        errorResponse: errorText,
        searchParams: searchParams
      });
      throw new Error(`ZoomInfo company search failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    logger.info('ZoomInfo company search completed', {
      totalResults: result.totalResults,
      currentPage: result.currentPage,
      maxResults: result.maxResults
    });

    return result;
  } catch (error) {
    logger.error('Error in ZoomInfo company search', {
      error: error instanceof Error ? error.message : String(error),
      searchParams: searchParams
    });
    throw error;
  }
}

export async function getContactFromCompany(
  searchParams: ZoomInfoContactSearchParams,
  token: string
): Promise<ZoomInfoContactSearchResponse> {
  logger.info('Searching for contacts in ZoomInfo company', { 
    companyId: searchParams.companyId,
    jobTitle: searchParams.jobTitle,
    jobFunction: searchParams.jobFunction,
    managementLevel: searchParams.managementLevel
  });

  try {
    const response = await fetch('https://api.zoominfo.com/search/contact', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ZoomInfo contact search API error', {
        status: response.status,
        statusText: response.statusText,
        errorResponse: errorText,
        searchParams: searchParams
      });
      throw new Error(`ZoomInfo contact search failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    logger.info('ZoomInfo contact search completed', {
      totalResults: result.totalResults,
      currentPage: result.currentPage,
      maxResults: result.maxResults,
      companyId: searchParams.companyId
    });

    return result;
  } catch (error) {
    logger.error('Error in ZoomInfo contact search', {
      error: error instanceof Error ? error.message : String(error),
      searchParams: searchParams
    });
    throw error;
  }
}

export async function enrichCompanyContact(
  enrichParams: ZoomInfoEnrichContactParams,
  token: string
): Promise<ZoomInfoEnrichContactResponse> {
  logger.info('Enriching contacts in ZoomInfo', { 
    contactCount: enrichParams.matchPersonInput.length,
    contactIds: enrichParams.matchPersonInput.map(p => p.personId),
    outputFieldsCount: enrichParams.outputFields.length
  });

  try {
    const response = await fetch('https://api.zoominfo.com/enrich/contact', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(enrichParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ZoomInfo contact enrichment API error', {
        status: response.status,
        statusText: response.statusText,
        errorResponse: errorText,
        contactCount: enrichParams.matchPersonInput.length,
        contactIds: enrichParams.matchPersonInput.map(p => p.personId)
      });
      throw new Error(`ZoomInfo contact enrichment failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    logger.info('ZoomInfo contact enrichment completed', {
      enrichedContactCount: result.data?.result?.length || 0
    });

    return result;
  } catch (error) {
    logger.error('Error in ZoomInfo contact enrichment', {
      error: error instanceof Error ? error.message : String(error),
      contactCount: enrichParams.matchPersonInput.length,
      contactIds: enrichParams.matchPersonInput.map(p => p.personId)
    });
    throw error;
  }
}
