#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnvFromFile(filePath) {
  const envContent = fs.readFileSync(filePath, 'utf8');
  const envVars = {};
  
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      envVars[key] = value.replace(/^["'](.*)["']$/, '$1');
    }
  });
  
  return envVars;
}

async function deleteAllImagesInFolder(supabaseUrl, folderPath) {
  const envPath = path.join(__dirname, '..', 'supabase', 'functions', '.env');
  const env = loadEnvFromFile(envPath);
  
  const supabase = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY);
  
  console.log(`Deleting all files in folder: ${folderPath}`);
  
  try {
    const { data: files, error: listError } = await supabase.storage
      .from('gh-vehicle-photos')
      .list(folderPath);
    
    if (listError) {
      console.error('Error listing files:', listError);
      return;
    }
    
    if (!files || files.length === 0) {
      console.log('No files found in the specified folder.');
      return;
    }
    
    console.log(`Found ${files.length} files to delete`);
    
    const filePaths = files.map(file => `${folderPath}/${file.name}`);
    
    const { data, error } = await supabase.storage
      .from('gh-vehicle-photos')
      .remove(filePaths);
    
    console.log('Delete API response data:', JSON.stringify(data, null, 2));
    
    if (error) {
      console.error('Error deleting files:', error);
      return;
    }
    
    console.log(`Successfully deleted ${filePaths.length} files`);
    console.log('Deleted files:', filePaths);
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

const args = process.argv.slice(2);

if (args.length !== 2) {
  console.log('Usage: node delete-storage-folder.js <supabase_url> <folder_path>');
  console.log('Example: node delete-storage-folder.js https://your-project.supabase.co originals');
  process.exit(1);
}

const [supabaseUrl, folderPath] = args;

deleteAllImagesInFolder(supabaseUrl, folderPath);
