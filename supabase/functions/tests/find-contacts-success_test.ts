import { assertEquals, assertExists, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "../find-contacts/index.ts";
import { MockZoomInfoService } from "../_shared/zoominfo-mocks.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from '../_shared/database.types.ts';

// Helper function to get a test company ID from the database
async function getTestCompanyId(): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Get the first company from the database (should be seeded data)
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id')
    .eq('name', 'ABC Plumbing Services')
    .limit(1);

  if (error || !companies || companies.length === 0) {
    throw new Error('No test company found in database');
  }

  return companies[0].id;
}

// Mock dequeue function that returns a test company
const mockDequeueWithCompany = async (client: any, n: number) => {
  const testCompanyId = await getTestCompanyId();
  return {
    data: [
      {
        id: 1,
        msg_id: 123,
        message: { company_id: testCompanyId }
      }
    ],
    error: null
  };
};

// Mock dequeue function that returns no messages
const mockEmptyDequeue = async (client: any, n: number) => {
  return {
    data: [],
    error: null
  };
};

// Helper function to check if queue has messages
async function checkEmailQueueSize(): Promise<number> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  const pgmqClient = createClient<Database, 'pgmq_public'>(supabaseUrl, supabaseKey, {
    db: { schema: "pgmq_public" },
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Use the read function to check queue size
  const { data, error } = await pgmqClient.rpc('read', {
    queue_name: 'email-generation',
    sleep_seconds: 0,
    n: 100
  });

  if (error) {
    console.error('Error checking queue size:', error);
    return 0;
  }

  return (data as any[])?.length || 0;
}

// Helper function to clear email queue for testing
async function clearEmailQueue(): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  const pgmqClient = createClient<Database, 'pgmq_public'>(supabaseUrl, supabaseKey, {
    db: { schema: "pgmq_public" },
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Read all messages from queue and delete them
  let hasMore = true;
  while (hasMore) {
    const { data: messages, error } = await pgmqClient.rpc('read', {
      queue_name: 'email-generation',
      sleep_seconds: 0,
      n: 10
    });

    if (error || !messages || messages.length === 0) {
      hasMore = false;
      break;
    }

    // Delete each message
    for (const message of messages as any[]) {
      await pgmqClient.rpc('delete', {
        queue_name: 'email-generation',
        message_id: message.msg_id
      });
    }
  }
}

Deno.test("find-contacts success - no messages to process", async () => {
  const req = new Request('http://localhost:54321/functions/v1/find-contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await handler(req, {
    dequeueElement: mockEmptyDequeue
  });

  assertEquals(response.status, 200);
  
  const responseData = await response.json();
  assertEquals(responseData.message, 'No new messages to process');
});

Deno.test("find-contacts success - successful ZoomInfo processing and queue upload", async () => {
  // Clear email queue before test
  await clearEmailQueue();
  
  const initialQueueSize = await checkEmailQueueSize();
  
  const mockZoomInfo = new MockZoomInfoService();
  
  const req = new Request('http://localhost:54321/functions/v1/find-contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await handler(req, {
    dequeueElement: mockDequeueWithCompany,
    zoomInfoService: mockZoomInfo
  });

  assertEquals(response.status, 200);
  
  const responseData = await response.json();
  assertEquals(responseData.message, 'Contact enrichment processing complete');
  
  // Check if contacts were queued (queue size should have increased)
  const finalQueueSize = await checkEmailQueueSize();
  assert(finalQueueSize > initialQueueSize, 
    `Queue size should increase from ${initialQueueSize} to ${finalQueueSize}`);
});

Deno.test("find-contacts success - ZoomInfo company not found", async () => {
  const mockZoomInfoNoCompany = new MockZoomInfoService();
  
  // Override to return no company results
  mockZoomInfoNoCompany.searchCompanies = async () => ({
    maxResults: 0,
    totalResults: 0,
    currentPage: 1,
    data: []
  });

  const req = new Request('http://localhost:54321/functions/v1/find-contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await handler(req, {
    dequeueElement: mockDequeueWithCompany,
    zoomInfoService: mockZoomInfoNoCompany
  });

  assertEquals(response.status, 200);
  
  const responseData = await response.json();
  assertEquals(responseData.message, 'Contact enrichment processing complete');
});

Deno.test("find-contacts success - ZoomInfo no contacts found", async () => {
  const mockZoomInfoNoContacts = new MockZoomInfoService();
  
  // Override to return no contacts
  mockZoomInfoNoContacts.searchContacts = async () => ({
    maxResults: 0,
    totalResults: 0,
    currentPage: 1,
    data: []
  });

  const req = new Request('http://localhost:54321/functions/v1/find-contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await handler(req, {
    dequeueElement: mockDequeueWithCompany,
    zoomInfoService: mockZoomInfoNoContacts
  });

  assertEquals(response.status, 200);
  
  const responseData = await response.json();
  assertEquals(responseData.message, 'Contact enrichment processing complete');
});

Deno.test("find-contacts success - revenue and title filtering", async () => {
  // Clear email queue before test
  await clearEmailQueue();
  
  const initialQueueSize = await checkEmailQueueSize();
  
  const mockZoomInfo = new MockZoomInfoService();
  
  const req = new Request('http://localhost:54321/functions/v1/find-contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await handler(req, {
    dequeueElement: mockDequeueWithCompany,
    zoomInfoService: mockZoomInfo
  });

  assertEquals(response.status, 200);
  
  const responseData = await response.json();
  assertEquals(responseData.message, 'Contact enrichment processing complete');
  
  // Verify that contacts meeting criteria were processed
  // Based on zoominfo-mocks.ts, all mock contacts have:
  // - companyRevenueNumeric >= 3000000 (meets 2000000 minimum)
  // - jobTitle contains "CEO", "President", or "Owner" (meets executive criteria)
  
  const finalQueueSize = await checkEmailQueueSize();
  
  // Since mock data has 3 contacts that should all meet criteria, 
  // we expect at least some to be queued
  assert(finalQueueSize > initialQueueSize, 
    `Should have queued contacts for email generation. Queue size: ${initialQueueSize} -> ${finalQueueSize}`);
});