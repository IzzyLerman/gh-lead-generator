#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: './supabase/functions/.env' })

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not found in supabase/functions/.env')
  process.exit(1)
}

const CONTACTS_WITH_EMAILS = [
  { name: 'John Smith', zoominfo_id: 12345, email: 'john@abcplumbing.com' },
  { name: 'Sarah Johnson', zoominfo_id: 12346, email: 'sarah@abcplumbing.com' },
  { name: 'Mike Rodriguez', zoominfo_id: 54321, email: 'mike@eliteelectric.com' },
  { name: 'David Chen', zoominfo_id: 11111, email: 'david@metrohvac.com' },
  { name: 'Lisa Thompson', zoominfo_id: 22222, email: 'lisa@metrohvac.com' },
  { name: 'Robert Wilson', zoominfo_id: 33333, email: 'robert@metrohvac.com' },
  { name: 'Maria Garcia', zoominfo_id: 67890, email: 'maria@sunshinelandscape.com' }
]

async function enqueueContact(zoominfo_id) {
  const pgmq_public = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "pgmq_public" }
  })

  const contact = CONTACTS_WITH_EMAILS.find(c => c.zoominfo_id === zoominfo_id)
  if (!contact) {
    console.error(`Contact with zoominfo_id ${zoominfo_id} not found in seed data`)
    process.exit(1)
  }

  console.log(`Enqueueing contact: ${contact.name} (${contact.email})`)

  const { data, error } = await pgmq_public.rpc('send', {
    queue_name: 'email-generation',
    message: { contact_zoominfo_id: zoominfo_id }
  })

  if (error) {
    console.error('Error enqueueing contact:', error)
    process.exit(1)
  }

  console.log(`Successfully enqueued contact with message ID: ${data}`)
}

const zoominfo_id = parseInt(process.argv[2]) || CONTACTS_WITH_EMAILS[0].zoominfo_id

enqueueContact(zoominfo_id)