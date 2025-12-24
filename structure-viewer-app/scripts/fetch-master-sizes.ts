#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface Result {
  url: string
  sizeMB: number | null
  error?: string
}

function getHeaders(origin: string): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8',
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': origin,
    'Referer': `${origin}/`,
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Connection': 'keep-alive',
  }
}

async function fetchSiteModels(siteUrl: string): Promise<any> {
  const url = new URL(siteUrl)
  url.searchParams.set('dumpSiteModels', 'true')
  const origin = url.origin
  
  console.log(`  Fetching site models for: ${siteUrl}`)
  
  const response = await fetch(url.toString(), { headers: getHeaders(origin) })
  if (!response.ok) {
    throw new Error(`Failed to fetch site models: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function ensureCompressedPageUrl(input: string): string {
  try {
    const u = new URL(input)
    const isPages = u.hostname.endsWith('pages.parastorage.com') && u.pathname.startsWith('/sites/')
    if (!isPages) return input
    if (!u.pathname.endsWith('.json.z')) {
      if (u.pathname.endsWith('.json')) {
        u.pathname = u.pathname.replace(/\.json$/, '.json.z')
      } else if (!u.pathname.endsWith('.json.z')) {
        u.pathname = `${u.pathname}.json.z`
      }
    }
    if (u.searchParams.get('v') !== '3') {
      u.searchParams.set('v', '3')
    }
    return u.toString()
  } catch {
    return input
  }
}

async function fetchMasterPageJson(masterFileName: string): Promise<string> {
  const jsonUrl = `https://pages.parastorage.com/sites/${masterFileName}`
  const normalizedUrl = ensureCompressedPageUrl(jsonUrl)
  const target = new URL(normalizedUrl)
  const targetOrigin = target.origin
  
  console.log(`  Fetching master page JSON: ${masterFileName}`)
  
  const response = await fetch(normalizedUrl, { headers: getHeaders(targetOrigin) })
  if (!response.ok) {
    throw new Error(`Failed to fetch master page: ${response.status} ${response.statusText}`)
  }
  const data = await response.json()
  return JSON.stringify(data)
}

function bytesToMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 1000) / 1000
}

async function processUrl(siteUrl: string): Promise<Result> {
  try {
    // Fetch site models
    const siteModels = await fetchSiteModels(siteUrl)
    
    // Extract master page filename
    const masterFileName: string | undefined = siteModels?.rendererModel?.pageList?.masterPageJsonFileName
    if (!masterFileName) {
      throw new Error('No master page filename found in site models')
    }
    
    // Fetch master page JSON
    const jsonString = await fetchMasterPageJson(masterFileName)
    
    // Calculate size
    const sizeBytes = new TextEncoder().encode(jsonString).length
    const sizeMB = bytesToMB(sizeBytes)
    
    console.log(`  ✓ Size: ${sizeMB} MB`)
    
    return { url: siteUrl, sizeMB }
  } catch (error: any) {
    console.error(`  ✗ Error: ${error.message}`)
    return { url: siteUrl, sizeMB: null, error: error.message }
  }
}

async function main() {
  // Get input file from args or use default
  const inputFile = process.argv[2] || 'urls.txt'
  const outputFile = process.argv[3] || 'master-page-sizes.csv'
  
  // Resolve paths
  const inputPath = path.isAbsolute(inputFile) ? inputFile : path.join(process.cwd(), inputFile)
  const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(process.cwd(), outputFile)
  
  // Check if input file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`)
    console.log('\nUsage: npx ts-node scripts/fetch-master-sizes.ts [input-file] [output-file]')
    console.log('  input-file:  Path to text file with URLs (one per line). Default: urls.txt')
    console.log('  output-file: Path to output CSV file. Default: master-page-sizes.csv')
    process.exit(1)
  }
  
  // Read and parse URLs
  const fileContent = fs.readFileSync(inputPath, 'utf-8')
  const urls = fileContent
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line && !line.startsWith('#'))
  
  if (urls.length === 0) {
    console.error('Error: No URLs found in input file')
    process.exit(1)
  }
  
  console.log(`Found ${urls.length} URLs to process\n`)
  
  // Process each URL
  const results: Result[] = []
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    console.log(`[${i + 1}/${urls.length}] Processing: ${url}`)
    const result = await processUrl(url)
    results.push(result)
    console.log('')
  }
  
  // Generate CSV
  const csvLines = ['URL,Size (MB),Error']
  for (const r of results) {
    const sizePart = r.sizeMB !== null ? r.sizeMB.toString() : ''
    const errorPart = r.error ? `"${r.error.replace(/"/g, '""')}"` : ''
    csvLines.push(`${r.url},${sizePart},${errorPart}`)
  }
  
  fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf-8')
  
  console.log('=' .repeat(60))
  console.log(`Results saved to: ${outputPath}`)
  console.log(`Total URLs processed: ${results.length}`)
  console.log(`Successful: ${results.filter((r: Result) => r.sizeMB !== null).length}`)
  console.log(`Failed: ${results.filter((r: Result) => r.sizeMB === null).length}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
