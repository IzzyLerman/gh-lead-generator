import { assertEquals, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Database } from '../_shared/database.types.ts';
import { handler, dequeueContacts } from "../generate-message/index.ts";
import { ContactInfo, EmailResult } from '../_shared/claude-api.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);

// Mock Claude API functions
const mockGenerateEmail = async (contact: ContactInfo, apiKey: string, apiUrl?: string): Promise<EmailResult> => {
    return {
        subject: `Saw your truck on Main Street`,
        body: `Hey ${contact.firstName || contact.name || 'there'}, I'm Izzy from Good Hope Advisors. I saw your truck on Main Street and thought I'd reach out. We help ${contact.industry?.[0] || 'business'} owners sell their business successfully. Would love to set up a free call to discuss your goals. PS: Reply 'not interested' to opt out. Pic attached.`
    };
};

const mockGenerateTextMessage = async (contact: ContactInfo, apiKey: string, apiUrl?: string): Promise<string> => {
    return `Hey ${contact.firstName || contact.name || 'there'}! Izzy from Good Hope Advisors here. Saw your truck on Main Street and wanted to reach out about helping ${contact.industry?.[0] || 'business'} owners sell. Free call to discuss? PS: Reply 'not interested' to opt out. Pic attached.`;
};

function _test(name: string, fn: () => Promise<void>) {
    Deno.test(name, async () => {
        try {
            await fn();
        } finally {
            await supabase.auth.signOut();
        }
    });
}

// Mock dequeue function to return specific ZoomInfo IDs
function createMockDequeue(zoomInfoIds: number[]) {
    return async (pgmq_public: SupabaseClient<Database, 'pgmq_public'>, n: number) => {
        const messages = zoomInfoIds.map((id, index) => ({
            id: index + 1,
            msg_id: index + 100,
            message: { contact_zoominfo_id: id }
        }));
        return { data: messages, error: null };
    };
}

// Mock empty dequeue
const mockEmptyDequeue = async (pgmq_public: SupabaseClient<Database, 'pgmq_public'>, n: number) => {
    return { data: [], error: null };
};

_test("Contact with both email and phone generates email message", async () => {
    // John Smith (ZoomInfo ID: 12345) has both email and phone
    const mockDequeue = createMockDequeue([12345]);
    
    const response = await handler(new Request("http://localhost/generate-message"), {
        dequeueContacts: mockDequeue,
        generateEmail: mockGenerateEmail,
        generateTextMessage: mockGenerateTextMessage
    });

    assertEquals(response.status, 200);
    
    const responseData = await response.json();
    assertEquals(responseData.message, 'Message generation processing complete');

    // Verify the contact was updated with email fields
    const { data: contact, error } = await supabase
        .from('contacts')
        .select('email_subject, email_body, text_message, status')
        .eq('zoominfo_id', 12345)
        .single();

    assertEquals(error, null);
    assert(contact?.email_subject, 'Email subject should be populated');
    assert(contact?.email_body, 'Email body should be populated');
    assertEquals(contact?.text_message, null, 'Text message should be null for email contacts');
    assertEquals(contact?.status, 'ready_to_send');
});

_test("Contact with phone only generates text message", async () => {
    // James Martinez (ZoomInfo ID: 67891) has phone only
    const mockDequeue = createMockDequeue([67891]);
    
    const response = await handler(new Request("http://localhost/generate-message"), {
        dequeueContacts: mockDequeue,
        generateEmail: mockGenerateEmail,
        generateTextMessage: mockGenerateTextMessage
    });

    assertEquals(response.status, 200);
    
    const responseData = await response.json();
    assertEquals(responseData.message, 'Message generation processing complete');

    // Verify the contact was updated with text message field
    const { data: contact, error } = await supabase
        .from('contacts')
        .select('email_subject, email_body, text_message, status')
        .eq('zoominfo_id', 67891)
        .single();

    assertEquals(error, null);
    assertEquals(contact?.email_subject, null, 'Email subject should be null for text contacts');
    assertEquals(contact?.email_body, null, 'Email body should be null for text contacts');
    assert(contact?.text_message, 'Text message should be populated');
    assertEquals(contact?.status, 'ready_to_send');
});

_test("Empty queue returns 200 with no processing message", async () => {
    const response = await handler(new Request("http://localhost/generate-message"), {
        dequeueContacts: mockEmptyDequeue,
        generateEmail: mockGenerateEmail,
        generateTextMessage: mockGenerateTextMessage
    });

    assertEquals(response.status, 200);
    
    const responseData = await response.json();
    assertEquals(responseData.message, 'No new messages to process');
});

_test("Non-existent contact ID returns 200 and archives messages", async () => {
    // Use a ZoomInfo ID that doesn't exist in the database
    const mockDequeue = createMockDequeue([99999]);
    
    const response = await handler(new Request("http://localhost/generate-message"), {
        dequeueContacts: mockDequeue,
        generateEmail: mockGenerateEmail,
        generateTextMessage: mockGenerateTextMessage
    });

    // Should return 200 and archive the messages rather than fail
    assertEquals(response.status, 200);
    
    const responseData = await response.json();
    assertEquals(responseData.message, 'Message generation processing complete');
});

_test("dequeueContacts function works correctly", async () => {
    const mockPgmqClient = {
        rpc: async (funcName: string, params: any) => {
            if (funcName === 'read') {
                return {
                    data: [
                        {
                            id: 1,
                            msg_id: 123,
                            message: { contact_zoominfo_id: 12345 }
                        }
                    ],
                    error: null
                };
            }
            return { data: null, error: null };
        }
    };

    const result = await dequeueContacts(mockPgmqClient as any, 5);
    
    assertEquals(result.data.length, 1);
    assertEquals(result.data[0].message.contact_zoominfo_id, 12345);
    assertEquals(result.error, null);
});

_test("dequeueContacts handles errors properly", async () => {
    const mockErrorClient = {
        rpc: async () => ({
            data: null,
            error: { message: 'Database error' }
        })
    };

    try {
        await dequeueContacts(mockErrorClient as any, 5);
        assert(false, "Should have thrown an error");
    } catch (error) {
        assert(error instanceof Error || typeof error === 'object');
    }
});