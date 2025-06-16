import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const pgmq = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { db: { schema: 'pgmq' } }
);

Deno.serve(async (req) => {
  try {
    const { data: messages, error: readError } = await pgmq.rpc('read', {
      queue_name: 'image-processing',
      vt: 30,
      qty: 1,
    });

    if (readError) {
      throw readError;
    }

    if (messages && messages.length > 0) {
      const message = messages[0];
      console.log('Processing message:', message.message);


      // If processing is successful, delete the message from the queue
      const { error: deleteError } = await pgmq.rpc('delete', {
        queue_name: 'image_processing',
        msg_id: message.msg_id,
      });

      if (deleteError) {
        console.error('Error deleting message:', deleteError);
      }

      return new Response(JSON.stringify({ success: true, processed_message: message.msg_id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({ status: 'No new messages' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/* To invoke locally:

 1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
 2. Make an HTTP request:

 curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/worker' \
  --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  --header 'Content-Type: application/json' \
  --data '{"name":"Functions"}'

*/
