# Lead Generation Pipeline

An automated pipeline for processing vehicle images to extract company information and generate business leads. The system uses OCR to extract text from vehicle photos, AI to parse company details, and contact enrichment APIs to find business contact information.

## Features

- **Image Processing**: Upload vehicle photos via HTTP endpoint or email integration
- **OCR Text Extraction**: Google Cloud Vision API extracts text from images
- **AI-Powered Parsing**: Anthropic Claude processes extracted text into structured company data
- **Contact Enrichment**: ZoomInfo API integration for finding company contact information
- **Data Storage**: PostgreSQL database with automated deduplication
- **Real-time Dashboard**: Next.js web interface for viewing and managing leads
- **Message Queue System**: Asynchronous processing with PostgreSQL-based queuing
- **Export Capabilities**: CSV export functionality for lead data

## Architecture

The system is built on **Supabase** and consists of three main components:

### Core Components

1. **receive-email** (Supabase Edge Function)
   - Accepts HTTP POST requests with image attachments
   - Uploads images to Supabase Storage
   - Enqueues processing jobs in PostgreSQL message queue

2. **worker** (Supabase Edge Function)
   - Dequeues jobs from message queue
   - Processes images with Google Cloud Vision API for OCR
   - Uses Anthropic Claude for parsing extracted text
   - Upserts company data to PostgreSQL database

3. **find-contacts** (Supabase Edge Function)
   - Enriches company data with contact information
   - Integrates with ZoomInfo API for contact lookup
   - Updates company records with email and phone data

4. **Dashboard** (Next.js Application)
   - Real-time web interface for viewing processed leads
   - Company data visualization and management
   - Photo gallery and processing status tracking
   - CSV export functionality

### Technology Stack

- **Runtime**: Deno for Edge Functions, Node.js for Dashboard
- **Database**: PostgreSQL with pgmq extension for message queuing
- **Storage**: Supabase Storage for image files
- **APIs**: 
  - Google Cloud Vision API (OCR)
  - Anthropic Claude API (text parsing)
  - ZoomInfo API (contact enrichment)
- **Frontend**: Next.js with TypeScript, Tailwind CSS

### Database Schema

Key tables:
- `companies`: Extracted company information (name, email, phone, industry, location)
- `contacts`: Individual contact information from enrichment APIs
- `vehicle_photos`: Image metadata and processing status
- `debug_logs`: Application logging and error tracking
- Message queues: `image-processing` and `contact-enrichment` in `pgmq_public` schema

## Local Development Setup

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/manual/getting_started/installation) (for Edge Functions)
- [Node.js](https://nodejs.org/) (for Dashboard)
- Docker (for local Supabase)

### Environment Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd gh-lead-generator
   ```

2. **Start local Supabase**
   ```bash
   supabase start
   ```

3. **Set up environment variables**
   
   Create `.env` file in `supabase/functions/`:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ANTHROPIC_API_KEY=your_anthropic_key
   ANTHROPIC_API_URL=https://api.anthropic.com
   VISION_API_URL=your_google_vision_url
   VISION_API_KEY=your_google_vision_key
   WORKER_URL=your_worker_function_url
   ```

4. **Install dependencies**
   ```bash
   # Root dependencies
   npm install
   
   # Dashboard dependencies
   cd dashboard
   npm install
   cd ..
   ```

### Running the Application

1. **Serve Edge Functions locally**
   ```bash
   supabase functions serve
   ```

2. **Run the Dashboard**
   ```bash
   cd dashboard
   npm run dev
   ```

3. **Access the application**
   - Dashboard: http://localhost:3000
   - Edge Functions: http://localhost:54321/functions/v1/

### Testing

**Run Edge Function tests:**
```bash
# From project root
./run_tests.sh

# Or directly with Deno
deno test --allow-all --env-file=./supabase/functions/.env ./supabase
```

**Run database tests:**
```bash
supabase test db
```

**Run end-to-end tests:**
```bash
deno test --allow-all --env-file=./supabase/functions/.env ./tests/e2e/
```

### Database Operations

**Generate TypeScript types:**
```bash
supabase gen types typescript --local > supabase/functions/_shared/database.types.ts
```

**Apply migrations:**
```bash
supabase db push
```

**Reset local database:**
```bash
supabase db reset --local
```

### Deployment

**Deploy Edge Functions:**
```bash
supabase functions deploy receive-email
supabase functions deploy worker
supabase functions deploy find-contacts
```

**Deploy Dashboard:**
Follow your preferred hosting platform's deployment instructions (Vercel, Netlify, etc.)

## Usage

### API Endpoints

**Upload images for processing:**
```bash
curl -X POST "your-supabase-url/functions/v1/receive-email" \
  -H "Authorization: Bearer your-anon-key" \
  -F "image=@vehicle-photo.jpg"
```

**View processing status:**
Access the dashboard or query the database directly through Supabase API.

### Dashboard Features

- View all processed companies and their details
- Browse vehicle photo gallery with processing status
- Export company data to CSV format
- Real-time updates as new images are processed

## Contributing

1. Follow the coding style guidelines in `CLAUDE.md`
2. Write tests for new functionality
3. Run the test suite before submitting changes
4. Use the provided development commands for consistency

## Security

- Never commit sensitive data to the repository
- Store API keys in Supabase Vault or environment variables
- Follow security best practices outlined in `SECURITY_AUDIT_REPORT.md`