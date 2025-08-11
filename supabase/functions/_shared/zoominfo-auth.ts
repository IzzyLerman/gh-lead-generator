import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Database } from './database.types.ts';

export interface ZoomInfoAuth {
  jwt_token: string;
  expires_at: string;
}

export class ZoomInfoAuthManager {
  private supabase;
  
  constructor(
    supabaseUrl: string,
    supabaseServiceRoleKey: string,
    clientConfig?: any
  ) {
    this.supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, clientConfig);
  }

  async getValidToken(): Promise<string> {
    // Check if we have a valid existing token
    const { data: existingAuth } = await this.supabase
      .from('zoominfo_auth')
      .select('jwt_token, expires_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingAuth && new Date(existingAuth.expires_at) > new Date()) {
      return existingAuth.jwt_token;
    }

    // Request a new token
    return await this.requestNewToken();
  }

  private async requestNewToken(): Promise<string> {
    const username = Deno.env.get('ZOOMINFO_USERNAME');
    const client_id = Deno.env.get('ZOOMINFO_CLIENT_ID');
    const private_key = Deno.env.get('ZOOMINFO_PRIVATE_KEY');

    if (!username || !client_id || !private_key) {
      throw new Error('ZoomInfo credentials not found in environment variables');
    }

    const authClient = await import('zoominfo-api-auth-client');
    
    let tokenResponse: string;
    try {
      tokenResponse = await authClient.getAccessTokenViaPKI(username, client_id, private_key);
    } catch (error) {
      console.error("Error in getAccessTokenViaPKI:", error);
      throw error;
    }
    
    if (!tokenResponse) {
      throw new Error('Failed to obtain ZoomInfo access token');
    }

    // Validate JWT format
    const tokenParts = tokenResponse.split('.');
    if (tokenParts.length !== 3 || tokenParts.some(part => part.length === 0)) {
      throw new Error(`Invalid JWT token format received: ${tokenResponse}`);
    }

    // JWT tokens from ZoomInfo are valid for 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Store the new token
    const { error } = await this.supabase
      .from('zoominfo_auth')
      .insert({
        jwt_token: tokenResponse,
        expires_at: expiresAt.toISOString()
      });

    if (error) {
      throw new Error(`Failed to store ZoomInfo token: ${error.message}`);
    }

    return tokenResponse;
  }
}
