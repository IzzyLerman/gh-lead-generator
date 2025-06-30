#!/bin/bash

echo "Running test suite..."
echo "====================="

# Reset local database
supabase db reset --local

# Run pgTAP tests
echo "Running pgTAP tests..."
supabase db test
DB_TEST_EXIT_CODE=$?

# Run deno tests
echo "Running deno tests..."
deno test --allow-all --env-file=./supabase/functions/.env ./supabase 
DENO_TEST_EXIT_CODE=$?

# Run e2e tests
echo "Running e2e tests..."
deno test --allow-all --env-file=./supabase/functions/.env ./tests/e2e
E2E_TEST_EXIT_CODE=$?

# Display summary
echo ""
echo "TEST SUMMARY"
echo "============"
if [ $DB_TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ pgTAP tests: PASSED"
else
    echo "❌ pgTAP tests: FAILED"
fi

if [ $DENO_TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ Deno tests: PASSED"
else
    echo "❌ Deno tests: FAILED"
fi

if [ $E2E_TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ E2E tests: PASSED"
else
    echo "❌ E2E tests: FAILED"
fi

# Exit with failure if any test failed
if [ $DB_TEST_EXIT_CODE -ne 0 ] || [ $DENO_TEST_EXIT_CODE -ne 0 ] || [ $E2E_TEST_EXIT_CODE -ne 0 ]; then
    exit 1
fi

echo ""
echo "🎉 All tests passed!"
