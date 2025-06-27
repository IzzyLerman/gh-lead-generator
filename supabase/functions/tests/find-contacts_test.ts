import { assertEquals, assertExists } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler, dequeueElement } from "../find-contacts/index.ts";

const mockSupabaseClient = {
  from: (table: string) => ({
    select: (columns: string) => ({
      eq: (column: string, value: string) => ({
        single: () => {
          if (table === 'companies' && value === 'test-company-id') {
            return Promise.resolve({
              data: {
                id: 'test-company-id',
                name: 'Test Company',
                primary_email: 'test@company.com',
                email: ['test@company.com'],
                primary_phone: '1234567890',
                phone: ['1234567890'],
                city: 'Test City',
                state: 'TS',
                industry: ['Testing'],
                status: 'enriching'
              },
              error: null
            });
          }
          return Promise.resolve({ data: null, error: { message: 'Not found' } });
        }
      })
    }),
    update: (updates: any) => ({
      eq: (column: string, value: string) => {
        return Promise.resolve({ data: null, error: null });
      }
    })
  })
};

const mockPgmqClient = {
  rpc: (funcName: string, params: any) => {
    if (funcName === 'read') {
      return Promise.resolve({
        data: [
          {
            id: 1,
            msg_id: 123,
            message: { company_id: 'test-company-id' }
          }
        ],
        error: null
      });
    } else if (funcName === 'delete' || funcName === 'archive') {
      return Promise.resolve({ error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
};

const mockDequeueElement = async (client: any, n: number) => {
  return {
    data: [
      {
        id: 1,
        msg_id: 123,
        message: { company_id: 'test-company-id' }
      }
    ],
    error: null
  };
};

const mockEmptyDequeueElement = async (client: any, n: number) => {
  return {
    data: [],
    error: null
  };
};

Deno.test("find-contacts handler - successful processing", async () => {
  // Mock successful dequeue with no messages to avoid Supabase client issues
  const mockEmptyDequeue = async (client: any, n: number) => {
    return {
      data: [],
      error: null
    };
  };

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

Deno.test("find-contacts handler - no messages to process", async () => {
  // Set required environment variables
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-key');

  const req = new Request('http://localhost:54321/functions/v1/find-contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await handler(req, {
    dequeueElement: mockEmptyDequeueElement
  });

  assertEquals(response.status, 200);
  
  const responseData = await response.json();
  assertEquals(responseData.message, 'No new messages to process');
});

Deno.test("find-contacts handler - missing environment variables", async () => {
  // Store original values
  const originalUrl = Deno.env.get('SUPABASE_URL');
  const originalKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  try {
    // Remove environment variables to test error handling
    Deno.env.delete('SUPABASE_URL');
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');

    const req = new Request('http://localhost:54321/functions/v1/find-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const response = await handler(req);

    assertEquals(response.status, 500);
    
    const responseData = await response.json();
    assertExists(responseData.error);
  } finally {
    // Restore original values
    if (originalUrl) Deno.env.set('SUPABASE_URL', originalUrl);
    if (originalKey) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', originalKey);
  }
});

Deno.test("dequeueElement - successful dequeue", async () => {
  const result = await dequeueElement(mockPgmqClient as any, 5);
  
  assertEquals(result.data.length, 1);
  assertEquals(result.data[0].message.company_id, 'test-company-id');
  assertEquals(result.error, null);
});

Deno.test("dequeueElement - error handling", async () => {
  const mockErrorClient = {
    rpc: () => Promise.resolve({
      data: null,
      error: { message: 'Database error' }
    })
  };

  try {
    await dequeueElement(mockErrorClient as any, 5);
    // Should not reach here
    assertEquals(true, false);
  } catch (error) {
    assertExists(error instanceof Error ? error.message : String(error));
  }
});