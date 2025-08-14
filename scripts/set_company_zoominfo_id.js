#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

function getEnvVar(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

async function deleteExistingContacts(companyId, supabase) {
  console.log(`Deleting existing contacts for company ${companyId}...`);
  
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('company_id', companyId);

  if (error) {
    console.error(`Error deleting contacts for company ${companyId}:`, error.message);
    throw error;
  }

  console.log(`✅ Successfully deleted existing contacts for company ${companyId}`);
}

async function setCompanyZoomInfoId(companyId, zoomInfoId, supabaseUrl, serviceRoleKey) {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const pgmqSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "pgmq_public" },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  await deleteExistingContacts(companyId, supabase);

  console.log(`Enqueuing company ${companyId} with ZoomInfo ID ${zoomInfoId}...`);
  
  const { error } = await pgmqSupabase.rpc('send', {
    queue_name: 'contact-enrichment',
    message: { 
      company_id: companyId,
      zoominfo_id: zoomInfoId
    }
  });

  if (error) {
    console.error(`Error enqueueing company ${companyId}:`, error.message);
    throw error;
  }

  console.log(`✅ Successfully enqueued company ${companyId} with ZoomInfo ID ${zoomInfoId}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
Usage: node set_company_zoominfo_id.js <company_id> <zoominfo_id> [supabase_url]

Arguments:
  company_id    - The UUID of the company to update
  zoominfo_id   - The ZoomInfo ID to associate with the company
  supabase_url  - Optional Supabase URL (defaults to SUPABASE_URL env var for local)

Examples:
  # Set ZoomInfo ID for local database
  node set_company_zoominfo_id.js 550e8400-e29b-41d4-a716-446655440000 12345678
  
  # Set ZoomInfo ID for remote database  
  node set_company_zoominfo_id.js 550e8400-e29b-41d4-a716-446655440000 12345678 https://your-project.supabase.co

This script will:
1. Delete all existing contacts for the company
2. Enqueue the company with the specified ZoomInfo ID for contact re-enrichment
`);
    process.exit(1);
  }

  const companyId = args[0];
  const zoomInfoId = parseInt(args[1]);
  const customUrl = args[2];
  
  if (isNaN(zoomInfoId)) {
    console.error('❌ ZoomInfo ID must be a valid number');
    process.exit(1);
  }
  
  let supabaseUrl, serviceRoleKey;
  
  if (customUrl) {
    supabaseUrl = customUrl;
    console.log('Using custom Supabase URL:', supabaseUrl);
    console.log('Please set SUPABASE_SERVICE_ROLE_KEY environment variable for the target instance');
    serviceRoleKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
  } else {
    supabaseUrl = getEnvVar('SUPABASE_URL');
    serviceRoleKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
    console.log('Using local Supabase instance');
  }

  try {
    await setCompanyZoomInfoId(companyId, zoomInfoId, supabaseUrl, serviceRoleKey);
    console.log('✅ Company ZoomInfo ID set and re-enqueued successfully');
  } catch (error) {
    console.error('❌ Failed to set company ZoomInfo ID:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);