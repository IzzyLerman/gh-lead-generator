#!/bin/bash

set -e

if [ ! -f "supabase/functions/.env" ]; then
    echo "Error: supabase/functions/.env file not found"
    exit 1
fi

source supabase/functions/.env

if [ -z "$SUPABASE_DB_URL" ]; then
    echo "Error: SUPABASE_DB_URL not found in environment"
    exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR=".backups"
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql"

mkdir -p "$BACKUP_DIR"

echo "Creating database backup..."
pg_dump "$SUPABASE_DB_URL" --no-password --verbose --clean --if-exists > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "Backup completed successfully: $BACKUP_FILE"
    
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "Backup size: $BACKUP_SIZE"
    
    echo "Listing recent backups:"
    ls -lah "$BACKUP_DIR" | tail -5
else
    echo "Backup failed"
    exit 1
fi
