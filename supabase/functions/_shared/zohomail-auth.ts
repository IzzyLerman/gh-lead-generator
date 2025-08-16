import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Database } from './database.types.ts';

export interface ZohoMailTokenResponse {
  access_token: string;
  refresh_token?: string;
  api_domain: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface ZohoMailAuth {
  access_token: string;
  refresh_token: string;
  valid_until: string;
}

export class ZohoMailAuthManager {
  private supabase;
  
  constructor(
    supabaseUrl: string,
    supabaseServiceRoleKey: string,
    clientConfig?: any
  ) {
    this.supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, clientConfig);
  }

  async getAccessToken(): Promise<string> {
    
    const { data: existingAuth } = await this.supabase
      .from('zohomail_auth')
      .select('access_token, refresh_token, valid_until')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();


    if (existingAuth) {
      const validUntil = new Date(existingAuth.valid_until);
      const now = new Date();
      const bufferTime = 55 * 60 * 1000; // 55 minutes in milliseconds
      const timeRemaining = validUntil.getTime() - now.getTime();
      
      
      if (timeRemaining > bufferTime) {
        console.log('ZohoMailAuthManager: Using existing valid token');
        return existingAuth.access_token;
      }
      
      if (existingAuth.refresh_token) {
        console.log('ZohoMailAuthManager: Token expired, attempting refresh');
        return await this.refreshToken(existingAuth.refresh_token);
      }
    }

    console.log('ZohoMailAuthManager: No valid token found, requesting new token');
    return await this.requestNewToken();
  }

  private async requestNewToken(): Promise<string> {
    const clientId = Deno.env.get('ZOHO_MAIL_CLIENT_ID');
    const clientSecret = Deno.env.get('ZOHO_MAIL_CLIENT_SECRET');
    const authorizationCode = Deno.env.get('ZOHO_MAIL_AUTHORIZATION_CODE');
    const redirectUri = Deno.env.get('ZOHO_MAIL_REDIRECT_URL');

    if (!clientId || !clientSecret || !authorizationCode || !redirectUri) {
      throw new Error('ZohoMail credentials not found in environment variables');
    }

    const url = 'https://accounts.zoho.com/oauth/v2/token';
    const params = new URLSearchParams({
      code: authorizationCode,
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      scope: 'ZohoMail.messages.ALL'
    });

    const requestHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    console.log('ZohoMailAuthManager: Outgoing HTTP request details:');
    console.log('URL:', url);
    console.log('Method: POST');
    console.log('Headers:', JSON.stringify(requestHeaders, null, 2));
    console.log('Body (raw):', params.toString());
    console.log('Body (parsed):');
    for (const [key, value] of params.entries()) {
      if (key === 'client_secret' || key === 'code') {
        console.log(`  ${key}: [REDACTED - length ${value.length}]`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log('ZohoMailAuthManager: Raw error response from requestNewToken:', errorText);
      throw new Error(`Failed to obtain ZohoMail access token: ${response.status} ${errorText}`);
    }

    const responseText = await response.text();
    console.log('ZohoMailAuthManager: Raw response from requestNewToken:', responseText);
    
    let tokenData: ZohoMailTokenResponse;
    try {
      tokenData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('ZohoMailAuthManager: Failed to parse response as JSON:', parseError);
      throw new Error(`Invalid response format from ZohoMail API: ${responseText}`);
    }
    
    if (!tokenData.access_token || !tokenData.refresh_token) {
      throw new Error('Invalid token response from ZohoMail API');
    }

    const validUntil = new Date(Date.now() + tokenData.expires_in * 1000);

    const { error } = await this.supabase
      .from('zohomail_auth')
      .insert({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        valid_until: validUntil.toISOString()
      });

    if (error) {
      throw new Error(`Failed to store ZohoMail token: ${error.message}`);
    }

    return tokenData.access_token;
  }

  private async refreshToken(refreshToken: string): Promise<string> {
    const clientId = Deno.env.get('ZOHO_MAIL_CLIENT_ID');
    const clientSecret = Deno.env.get('ZOHO_MAIL_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('ZohoMail client credentials not found in environment variables');
    }

    const url = 'https://accounts.zoho.com/oauth/v2/token';
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to refresh ZohoMail access token: ${response.status} ${errorText}`);
    }

    const tokenData: ZohoMailTokenResponse = await response.json();
    
    if (!tokenData.access_token) {
      throw new Error('Invalid refresh token response from ZohoMail API');
    }

    const validUntil = new Date(Date.now() + tokenData.expires_in * 1000);

    const { error } = await this.supabase
      .from('zohomail_auth')
      .update({
        access_token: tokenData.access_token,
        valid_until: validUntil.toISOString()
      })
      .eq('refresh_token', refreshToken);

    if (error) {
      throw new Error(`Failed to update ZohoMail token: ${error.message}`);
    }

    return tokenData.access_token;
  }
}

export async function getAccessToken(): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase credentials not found in environment variables');
  }

  const authManager = new ZohoMailAuthManager(supabaseUrl, supabaseServiceRoleKey);
  return await authManager.getAccessToken();
}
