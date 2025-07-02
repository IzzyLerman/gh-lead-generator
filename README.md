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

The system is built on **Supabase** and consists of five main components:

### Core Components

1. **Email Relay Lambda** (AWS Lambda Function)
   - Acts as entry point for email-based workflow
   - Receives S3 events when emails arrive in `gh-vehicle-emails` bucket
   - Parses emails and extracts image/video attachments (JPEG, PNG, WebP, HEIC, MP4, MOV)
   - Validates and filters attachments (max 5 per email)
   - Forwards attachments to Supabase with HMAC-SHA256 authentication
   - Handles security with PII redaction and structured error logging

2. **receive-email** (Supabase Edge Function)
   - Accepts HTTP POST requests with image attachments from Lambda or direct upload
   - Uploads images to Supabase Storage
   - Enqueues processing jobs in PostgreSQL message queue

3. **worker** (Supabase Edge Function)
   - Dequeues jobs from message queue
   - Processes images with Google Cloud Vision API for OCR
   - Uses Anthropic Claude for parsing extracted text
   - Upserts company data to PostgreSQL database

4. **find-contacts** (Supabase Edge Function)
   - Enriches company data with contact information
   - Integrates with ZoomInfo API for contact lookup
   - Updates company records with email and phone data

5. **Dashboard** (Next.js Application)
   - Real-time web interface for viewing processed leads
   - Company data visualization and management
   - Photo gallery and processing status tracking
   - CSV export functionality

### Technology Stack

- **Runtime**: AWS Lambda (Node.js), Deno for Edge Functions, Node.js for Dashboard
- **Database**: PostgreSQL with pgmq extension for message queuing
- **Storage**: AWS S3 for email storage, Supabase Storage for processed images
- **APIs**: 
  - Google Cloud Vision API (OCR)
  - Anthropic Claude API (text parsing)
  - ZoomInfo API (contact enrichment)
  - Geoapify API (reverse geocoding GPS EXIF data)
  - Cloudinary API (screenshotting videos)
- **Frontend**: Next.js with TypeScript, Tailwind CSS
- **Infrastructure**: AWS Lambda, Supabase, S3

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
- Docker Desktop (for local Supabase)

### Environment Setup

I recommend local development. It's easy to push your changes to remote Supabase, AWS, and Vercel from there using the CLI.

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd gh-lead-generator
   ```

2. **Set up environment variables**
   
   You need to create four `.env` files in different locations:

   **A. Supabase Functions (`supabase/functions/.env`):**
   ```env
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   
   ANTHROPIC_API_KEY=your_anthropic_api_key
   ANTHROPIC_API_URL=https://api.anthropic.com/v1/messages
   VISION_API_URL=https://vision.googleapis.com/v1/images:annotate
   VISION_API_KEY=your_google_vision_api_key
   
   ZOOMINFO_USERNAME=your_zoominfo_username
   ZOOMINFO_PASSWORD=your_zoominfo_password
   
   CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
   CLOUDINARY_API_KEY=your_cloudinary_api_key
   CLOUDINARY_API_SECRET=your_cloudinary_api_secret
   CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
   
   GEOAPIFY_API_KEY=your_geoapify_api_key
   
   WEBHOOK_SECRET=your_secure_webhook_secret
   WORKER_URL=http://kong:8000/functions/v1 # Use kong:8000 for calling Edge Function from database functions
   
   USE_MOCK_VISION=true # Recommended, since Vision can't access signed URLs on locally hosted DB
   USE_MOCK_LLM=false
   ENVIRONMENT=development
   RECEIVE_EMAIL_URL=http://127.0.0.1:54321/functions/v1/receive-email
   DASHBOARD_URL=http://localhost:3000
   E2E_REAL_APIS=false
   ```

   **B. Supabase (needed for automatic loading of env variables into Vault)**
   WORKER_URL=http://kong:8000/functions/v1 # Use kong:8000 for calling Edge Function from database functions
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key


   **C. Lambda Function (`lambda/.env`):**
   ```env
   RECEIVE_EMAIL_URL=https://your-project.supabase.co/functions/v1/receive-email
   WEBHOOK_SECRET=same_secret_as_supabase_functions
   ENVIRONMENT=development
   ```

   **D. Dashboard (`dashboard/.env.local`):**
   ```env
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   
   DB_EMAIL=your_login_email@example.com 
   
   NEXT_PUBLIC_SUPABASE_HOSTNAME=http://127.0.0.1
   ENVIRONMENT=development
   
   ```

3. **Start local Supabase**
   ```bash
   supabase start
   ```


4. **Install dependencies**
   ```bash
   # Root dependencies
   deno install
   
   # Lambda dependencies  
   cd lambda
   npm install
   cd ..
   
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

**Apply migrations to remote:**
```bash
supabase db push
```

**Reset local database:**
```bash
supabase db reset --local
```

### CI/CD

Upon push or merge to main, testing and deployment scripts are run through GitHub Actions (.github/workflows/{ci.yml, deploy.yml}). Add "[skip ci]" to your commit to skip CI/CD.

### Manual Deployment

**Deploy Lambda Function:**
```bash
cd lambda
# Package and deploy to AWS Lambda (follow AWS deployment process)
zip -r lambda-function.zip index.js utils/ node_modules/
# Upload to AWS Lambda or use AWS CLI/CDK/Terraform
# Configure environment variables through Lambda UI
```

**Deploy Edge Functions:**
```bash
supabase functions deploy receive-email
supabase functions deploy worker
supabase functions deploy find-contacts
# Set env variables as Edge Function Secrets in Supabase Studio
```

**Deploy Dashboard:**
Follow your preferred hosting platform's deployment instructions (Vercel, Netlify, etc.)

## Usage

### API Endpoints

**Generate an authenticated POST request to receive-email:**
```bash
node generate-signature.js [--sender-email=email] <file1> [file2] [file3] ...
```

**View processing status:**
Access the dashboard or query the database directly through Supabase API.

### Dashboard Features

- View all processed companies and their details
- Browse vehicle photo gallery with processing status
- Keep track of submitters for bounty program
- Export company data to CSV format
- Real-time updates as new images are processed

