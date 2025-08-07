#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { load } from 'https://deno.land/std@0.208.0/dotenv/mod.ts';
import type { Database } from '../supabase/functions/_shared/database.types.ts';

const TEST_ZOOMINFO_ID = "12345";

const env = await load({ envPath: './supabase/functions/.env' });
for (const [key, value] of Object.entries(env)) {
  Deno.env.set(key, value);
}

async function queryContacts() {
  try {
    console.log('Creating Supabase client...');
    const supabase = createClient<Database>(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('Querying contacts table...');
    const contact = { zoominfo_id: TEST_ZOOMINFO_ID };
    
    const {data: existingData, error: selectError} = await supabase
      .from("contacts")
      .select("zoominfo_id")
      .eq("zoominfo_id", contact.zoominfo_id);

    console.log(`Existing data: ${JSON.stringify(existingData)}`);
    if(selectError) throw new Error("Failed to query the contacts tables for existing contact.");

    console.log('Query completed successfully');

  } catch (error) {
    console.error('Error querying contacts:', error);
    Deno.exit(1);
  }
}

queryContacts();