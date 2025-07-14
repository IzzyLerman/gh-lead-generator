#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { ZoomInfoAuthManager } from './supabase/functions/_shared/zoominfo-auth.ts';
import { load } from 'https://deno.land/std@0.208.0/dotenv/mod.ts';

// Load environment variables from .env file
const env = await load({ envPath: './supabase/functions/.env' });
for (const [key, value] of Object.entries(env)) {
  Deno.env.set(key, value);
}

// Parse command line arguments
const args = Deno.args;
let method = 'GET';
let path = '/lookup/country?=';
let postData = null;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--method' && i + 1 < args.length) {
    method = args[i + 1].toUpperCase();
    i++;
  } else if (args[i] === '--path' && i + 1 < args.length) {
    path = args[i + 1];
    i++;
  } else if (args[i] === '--data' && i + 1 < args.length) {
    try {
      postData = JSON.parse(args[i + 1]);
    } catch (e) {
      console.error('Error parsing JSON data:', e.message);
      Deno.exit(1);
    }
    i++;
  }
}

async function makeZoomInfoApiCall() {
  try {
    // Debug environment variables
    console.log('SUPABASE_URL:', Deno.env.get('SUPABASE_URL'));
    console.log('SUPABASE_SERVICE_ROLE_KEY:', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ? 'Present' : 'Missing');
    
    // Get auth token using existing auth system
    console.log('Creating auth manager...');
    const authManager = new ZoomInfoAuthManager(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    console.log('Getting token...');
    const token = await authManager.getValidToken();
    console.log('Token obtained:', token ? 'Present' : 'Missing');
    
    // Set up request options
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };

    // Add Content-Type header for POST requests
    if (method === 'POST' && postData) {
      headers['Content-Type'] = 'application/json';
    }

    // Make the API request using fetch
    const url = `https://api.zoominfo.com${path}`;
    const requestOptions: RequestInit = {
      method: method,
      headers: headers,
    };

    // Add body for POST requests
    if (method === 'POST' && postData) {
      requestOptions.body = JSON.stringify(postData);
    }

    const response = await fetch(url, requestOptions);
    const responseText = await response.text();
    
    console.log(responseText);

  } catch (error) {
    console.error('Error making ZoomInfo API call:', error);
    Deno.exit(1);
  }
}

// Show usage if no arguments provided
if (args.length === 0) {
  console.log(`Usage: ./zoominfo-api-call.ts [--method GET|POST] [--path /api/path] [--data '{"key":"value"}']

Examples:
  # GET request
  ./zoominfo-api-call.ts --method GET --path "/lookup/country?="
  
  # POST request with data
  ./zoominfo-api-call.ts --method POST --path "/search/company" --data '{"metroRegion":"usa.california.sanfrancisco","industryCodes":"education.university","oneYearEmployeeGrowthRateMin":"10","oneYearEmployeeGrowthRateMax":"50"}'
`);
  Deno.exit(0);
}

makeZoomInfoApiCall();