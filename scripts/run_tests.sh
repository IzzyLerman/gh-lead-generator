#!/bin/bash

# Parse command line arguments
SUITES=""
while getopts "s:" opt; do
    case $opt in
        s)
            SUITES="$OPTARG"
            ;;
        \?)
            echo "Usage: $0 [-s \"db,unit,e2e\"]"
            echo "  -s: Comma-separated list of test suites to run (db, unit, e2e)"
            echo "      If not specified, all test suites will run"
            exit 1
            ;;
    esac
done

# If no suites specified, run all
if [ -z "$SUITES" ]; then
    SUITES="db,unit,e2e"
fi

echo "Running test suite..."
echo "====================="

# Initialize exit codes
DB_TEST_EXIT_CODE=0
DENO_TEST_EXIT_CODE=0
E2E_TEST_EXIT_CODE=0

# Check if db tests should run
if [[ "$SUITES" == *"db"* ]]; then
    # Reset local database
    supabase db reset --local
    
    # Run pgTAP tests
    echo "Running pgTAP tests..."
    supabase db test
    DB_TEST_EXIT_CODE=$?
fi

# Check if unit tests should run
if [[ "$SUITES" == *"unit"* ]]; then
    supabase db reset --local

    # Run deno tests with test environment
    echo "Running deno tests..."
    deno test --allow-all --env-file=./supabase/functions/.env.test ./supabase 
    DENO_TEST_EXIT_CODE=$?
fi

# Check if e2e tests should run
if [[ "$SUITES" == *"e2e"* ]]; then
    # Generate timestamp for log file
    LOG_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    FUNCTIONS_LOG_FILE=".logs/functions_${LOG_TIMESTAMP}.log"
    
    # Create logs directory if it doesn't exist
    mkdir -p .logs
    
    # Start functions with test environment and pipe output to log file
    echo "Starting functions server with test environment (logging to $FUNCTIONS_LOG_FILE)..."
    supabase functions serve --env-file=./supabase/functions/.env.test > "$FUNCTIONS_LOG_FILE" 2>&1 &
    FUNCTIONS_PID=$!
    
    # Wait for functions to start up
    echo "Waiting for functions to start..."
    sleep 1
    
    # Run e2e tests with test environment
    echo "Running E2E tests..."
    deno test --allow-all --env-file=./supabase/functions/.env.test ./tests/e2e
    E2E_TEST_EXIT_CODE=$?
    
    # Stop functions server
    echo "Stopping functions server..."
    kill $FUNCTIONS_PID 2>/dev/null || true
    
    # Wait a moment for cleanup
    sleep 1
    
    # Show log file location for debugging
    echo "Functions server logs available at: $FUNCTIONS_LOG_FILE"
fi

# Display summary
echo ""
echo "TEST SUMMARY"
echo "============"
if [[ "$SUITES" == *"db"* ]]; then
    if [ $DB_TEST_EXIT_CODE -eq 0 ]; then
        echo "✅ pgTAP tests: PASSED"
    else
        echo "❌ pgTAP tests: FAILED"
    fi
fi

if [[ "$SUITES" == *"unit"* ]]; then
    if [ $DENO_TEST_EXIT_CODE -eq 0 ]; then
        echo "✅ Deno tests: PASSED"
    else
        echo "❌ Deno tests: FAILED"
    fi
fi

if [[ "$SUITES" == *"e2e"* ]]; then
    if [ $E2E_TEST_EXIT_CODE -eq 0 ]; then
        echo "✅ E2E tests: PASSED"
    else
        echo "❌ E2E tests: FAILED"
    fi
fi

# Exit with failure if any test failed
if [ $DB_TEST_EXIT_CODE -ne 0 ] || [ $DENO_TEST_EXIT_CODE -ne 0 ] || [ $E2E_TEST_EXIT_CODE -ne 0 ]; then
    exit 1
fi

echo ""
echo "🎉 All tests passed!"
