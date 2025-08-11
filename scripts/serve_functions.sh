# This function is used for MANUAL TESTING and USES THE REAL APIS

 LOG_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
 FUNCTIONS_LOG_FILE=".logs/functions_${LOG_TIMESTAMP}.log"
 
 # Create logs directory if it doesn't exist
 mkdir -p .logs
 
 # Start functions with local dev environment and pipe output to log file
 echo "Starting functions server with production environment (logging to $FUNCTIONS_LOG_FILE)..."
 supabase functions serve --no-verify-jwt --env-file=./supabase/functions/.env > "$FUNCTIONS_LOG_FILE" 2>&1 &
