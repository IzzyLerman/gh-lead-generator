export interface ZoomInfoCompanySearchParams {
  companyName?: string;
  companyWebsite?: string;
  address?: string;
  state?: string;
  country?: string;
  IndustryCodes?: string[];
  sicCodes?: string[];
  naicsCodes?: string[];
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

export async function getCompanyFromZoomInfo(
  searchParams: ZoomInfoCompanySearchParams,
  token: string
): Promise<ZoomInfoCompanySearchResponse> {
  throw new Error('ZoomInfo API integration not yet implemented');
}