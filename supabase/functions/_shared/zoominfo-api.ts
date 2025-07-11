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
  const response = await fetch('https://api.zoominfo.com/search/company', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchParams),
  });

  if (!response.ok) {
    throw new Error(`ZoomInfo API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}
