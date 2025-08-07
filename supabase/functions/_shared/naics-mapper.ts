import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Database } from './database.types.ts';

interface NaicsMapping {
  [code: string]: string;
}

async function loadNaicsMappings(): Promise<NaicsMapping> {
  try {
    const csvPath = '/home/izzy/gh-lead-generator/supabase/data/NAICS-codes-mapping.csv';
    const csvContent = await Deno.readTextFile(csvPath);
    const lines = csvContent.split('\n');
    
    const mappings: NaicsMapping = {};
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const columns = parseCSVLine(line);
      if (columns.length >= 3) {
        const naicsCode = columns[1].trim();
        const title = columns[2].trim().replace(/T$/, '');
        
        if (naicsCode && title) {
          mappings[naicsCode] = title;
        }
      }
    }
    
    return mappings;
  } catch (error) {
    console.error('Failed to load NAICS mappings:', error);
    return {};
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

export async function getNaicsIndustries(
  supabaseUrl: string,
  supabaseKey: string,
  company_id: string
): Promise<string[]> {
  try {
    const supabase = createClient<Database>(supabaseUrl, supabaseKey);
    
    const { data: company, error } = await supabase
      .from('companies')
      .select('naics_codes')
      .eq('id', company_id)
      .single();
    
    if (error || !company?.naics_codes) {
      return [];
    }
    
    const naicsCodes = company.naics_codes.split(',').map(code => code.trim());
    const naicsMappings = await loadNaicsMappings();
    
    const industries: string[] = [];
    for (const code of naicsCodes) {
      const industry = naicsMappings[code];
      if (industry) {
        industries.push(industry);
      }
    }
    
    return industries;
  } catch (error) {
    console.error('Failed to get NAICS industries:', error);
    return [];
  }
}