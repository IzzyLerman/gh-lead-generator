#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

function getEnvVar(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

async function enqueueCompanyForContacts(companyId, supabaseUrl, serviceRoleKey) {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "pgmq_public" },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { error } = await supabase.rpc('send', {
    queue_name: 'contact-enrichment',
    message: { company_id: companyId }
  });

  if (error) {
    console.error(`Error enqueueing company ${companyId}:`, error.message);
    throw error;
  }

  console.log(`Successfully enqueued company ${companyId} for contact enrichment`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node enqueue_for_contacts.js <company_id> [supabase_url]

Arguments:
  company_id    - The UUID of the company to enqueue for contact enrichment
  supabase_url  - Optional Supabase URL (defaults to SUPABASE_URL env var for local)

Examples:
  # Enqueue company for local database
  node enqueue_for_contacts.js 550e8400-e29b-41d4-a716-446655440000
  
  # Enqueue company for remote database  
  node enqueue_for_contacts.js 550e8400-e29b-41d4-a716-446655440000 https://your-project.supabase.co
`);
    process.exit(1);
  }

  const companyId = args[0];
  const customUrl = args[1];
  
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
    await enqueueCompanyForContacts(companyId, supabaseUrl, serviceRoleKey);
    console.log('✅ Company successfully enqueued for contact enrichment');
  } catch (error) {
    console.error('❌ Failed to enqueue company:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);