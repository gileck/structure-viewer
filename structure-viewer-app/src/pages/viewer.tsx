import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { MutableRefObject, RefObject } from 'react'
import Link from 'next/link'

type AnyRecord = Record<string, any>

// Utilities ported from app.js with type-safe wrappers
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

function normalizeRoot(data: AnyRecord) {
  if (data && typeof data === 'object' && data.structure && typeof data.structure === 'object') {
    return data.structure
  }
  return data
}

function hasChildren(node: AnyRecord) {
  const c1 = Array.isArray(node.children) && node.children.length > 0
  const c2 = Array.isArray(node.components) && node.components.length > 0
  return c1 || c2
}

function getChildren(node: AnyRecord): AnyRecord[] {
  if (Array.isArray(node.children)) return node.children
  if (Array.isArray(node.components)) return node.components
  return []
}

function getDescendantCount(node: AnyRecord): number {
  const children = getChildren(node)
  let total = children.length
  for (const child of children) total += getDescendantCount(child)
  return total
}

function getNodeLabel(node: AnyRecord) {
  const id = node.id || node.name || '(no-id)'
  const type = node.componentType || node.type || ''
  return { id, type }
}

const DATA_MAP_MAPPINGS: Record<string, string> = {
  'dataQuery': 'document_data',
  'designQuery': 'design_data', 
  'behaviorsQuery': 'behaviors_data',
  'connectionQuery': 'connections_data',
  'themeQuery': 'theme_data',
  'layoutQuery': 'layout_data',
  'componentPropertiesQuery': 'component_properties',
  'mobileHintsQuery': 'mobile_hints',
  'atomicScopesQuery': 'atomicScopes',
  'classnamesQuery': 'classnames',
  'editorsettingsQuery': 'editorsettings',
  'fixerVersionsQuery': 'fixerVersions',
  'namingQuery': 'naming',
  'reactionsQuery': 'reactions',
  'slotsQuery': 'slots',
  'sourceQuery': 'source',
  'statesQuery': 'states',
  'themeConfigQuery': 'themeConfig',
  'transformationsQuery': 'transformations_data',
  'transitionsQuery': 'transitions_data',
  'triggersQuery': 'triggers',
  'variablesQuery': 'variables',
  'variantsQuery': 'variants_data',
  'groupingQuery': 'grouping',
  'propertyQuery': 'component_properties',
  'breakpointVariantsQuery': 'variants_data'
}

export default function Viewer() {
  const [status, setStatus] = useState('')
  const [root, setRoot] = useState<AnyRecord | null>(null)
  const [fullJSON, setFullJSON] = useState<AnyRecord | null>(null)
  const [jsonUrl, setJsonUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [jsonSizeBytes, setJsonSizeBytes] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'structure' | 'data'>('structure')

  const containerRef = useRef<HTMLDivElement>(null)

  const [siteUrl, setSiteUrl] = useState<string | null>(null)
  const [referencedIds, setReferencedIds] = useState<Set<string> | null>(null)
  const [isCalculatingRefs, setIsCalculatingRefs] = useState(false)

  const structureCount = useMemo(() => {
    if (!root) return 0
    return getDescendantCount(root) + 1 // +1 for root itself
  }, [root])

  const dataKeysCount = useMemo(() => {
    if (!fullJSON?.data || typeof fullJSON.data !== 'object') return 0
    let total = 0
    // Count first level keys
    const firstLevelKeys = Object.keys(fullJSON.data)
    total += firstLevelKeys.length
    // Count second level keys
    for (const key of firstLevelKeys) {
      const value = fullJSON.data[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        total += Object.keys(value).length
      }
    }
    return total
  }, [fullJSON])

  const resolveQueryValue = useCallback((key: string, value: any) => {
    if (!fullJSON || typeof value !== 'string') return value
    const dataMapKey = DATA_MAP_MAPPINGS[key]
    const tryIds: string[] = []
    const queryId = value.startsWith('#') ? value.substring(1) : value
    tryIds.push(queryId)
    if (queryId !== value) tryIds.push(value)
    const containers = [fullJSON, (fullJSON as any).data].filter(Boolean) as AnyRecord[]
    if (dataMapKey) {
      for (const container of containers) {
        const dataMap = container[dataMapKey]
        if (dataMap && typeof dataMap === 'object') {
          for (const id of tryIds) {
            if (id in dataMap) return dataMap[id]
          }
        }
      }
    }
    for (const mapKey of Object.values(DATA_MAP_MAPPINGS)) {
      for (const container of containers) {
        const candidate = container[mapKey]
        if (!candidate || typeof candidate !== 'object') continue
        for (const id of tryIds) {
          if (id in candidate) return candidate[id]
        }
      }
    }
    return { __unresolved: true, originalQuery: value, queryId }
  }, [fullJSON])

  // Calculate all referenced IDs when switching to Data tab
  const calculateReferencedIds = useCallback(() => {
    if (!root || !fullJSON) return
    
    setIsCalculatingRefs(true)
    
    setTimeout(() => {
      const ids = new Set<string>()
      
      const collectRefsFromObject = (obj: any) => {
        if (!obj || typeof obj !== 'object') return
        
        if (Array.isArray(obj)) {
          for (const item of obj) {
            if (typeof item === 'string' && looksLikeDataRef(item)) {
              const refId = item.startsWith('#') ? item.slice(1) : item
              if (!ids.has(refId)) {
                ids.add(refId)
                // Resolve and recurse
                const resolved = tryResolveFromDataMaps(refId, fullJSON)
                if (resolved) {
                  collectRefsFromObject(resolved.data)
                }
              }
            } else if (typeof item === 'object') {
              collectRefsFromObject(item)
            }
          }
        } else {
          for (const value of Object.values(obj)) {
            if (typeof value === 'string' && looksLikeDataRef(value)) {
              const refId = value.startsWith('#') ? value.slice(1) : value
              if (!ids.has(refId)) {
                ids.add(refId)
                // Resolve and recurse
                const resolved = tryResolveFromDataMaps(refId, fullJSON)
                if (resolved) {
                  collectRefsFromObject(resolved.data)
                }
              }
            } else if (typeof value === 'object') {
              collectRefsFromObject(value)
            }
          }
        }
      }
      
      const processNode = (node: AnyRecord) => {
        // Process all *Query properties
        for (const [key, value] of Object.entries(node)) {
          if (key.endsWith('Query') && typeof value === 'string') {
            const queryId = value.startsWith('#') ? value.slice(1) : value
            if (!ids.has(queryId)) {
              ids.add(queryId)
              const resolved = resolveQueryValue(key, value)
              if (resolved && typeof resolved === 'object' && !(resolved as any).__unresolved) {
                collectRefsFromObject(resolved)
              }
            }
          }
        }
        
        // Process styleId
        if (typeof node.styleId === 'string' && node.styleId) {
          ids.add(node.styleId)
          const resolved = tryResolveFromDataMaps(node.styleId, fullJSON)
          if (resolved) {
            collectRefsFromObject(resolved.data)
          }
        }
        
        // Process children
        const children = getChildren(node)
        for (const child of children) {
          processNode(child)
        }
      }
      
      processNode(root)
      setReferencedIds(ids)
      setIsCalculatingRefs(false)
      console.log(`Calculated ${ids.size} referenced IDs`)
    }, 10)
  }, [root, fullJSON, resolveQueryValue])
  
  // Calculate referenced IDs when switching to Data tab
  useEffect(() => {
    if (activeTab === 'data' && root && fullJSON && !referencedIds && !isCalculatingRefs) {
      calculateReferencedIds()
    }
  }, [activeTab, root, fullJSON, referencedIds, isCalculatingRefs, calculateReferencedIds])

  const fetchJSON = useCallback(async (url: string) => {
    setStatus('Fetching JSON…')
    setIsLoading(true)
    const res = await fetch(`/api/page-json?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error(`Failed: ${res.status}`)
    const data = await res.json()
    try {
      const size = new TextEncoder().encode(JSON.stringify(data)).length
      setJsonSizeBytes(size)
    } catch {}
    setFullJSON(data)
    setRoot(normalizeRoot(data))
    setStatus('Loaded')
    setIsLoading(false)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const url = params.get('url')
    const site = params.get('site')
    setSiteUrl(site)
    
    if (url) {
      const normalized = ensureCompressedPageUrl(url)
      if (normalized !== url) {
        const loc = new URL(window.location.href)
        loc.searchParams.set('url', normalized)
        // Preserve the site parameter if it exists
        if (site) {
          loc.searchParams.set('site', site)
        }
        window.history.replaceState({}, '', loc)
      }
      setJsonUrl(normalized)
      fetchJSON(normalized).catch(e => setStatus(e?.message || 'Failed to load'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          {siteUrl && (
            <div className="mb-2">
              <Link 
                href={`/site?site=${encodeURIComponent(siteUrl)}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-[color:var(--border)] bg-white text-[color:var(--text)] hover:bg-gray-50 transition"
              >
                ← Back to Site
              </Link>
            </div>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">Structure Viewer</h1>
          <p className="text-sm text-[color:var(--muted)]">View your JSON structure as a nested tree · <Link href="/site" className="text-blue-600 hover:underline">Load a site</Link></p>
          <p className="text-sm text-[color:var(--muted)]" aria-live="polite">{isLoading ? 'Loading…' : status}</p>
          {jsonUrl ? (
            <p className="text-sm text-[color:var(--muted)]">
              {(() => {
                let id = ''
                try { const u = new URL(jsonUrl!); id = (u.pathname.split('/').pop() || '') } catch {}
                const sizeText = jsonSizeBytes != null ? ` (${formatBytes(jsonSizeBytes)})` : ''
                return (
                  <>
                    {'Current JSON: '}
                    <a href={jsonUrl!} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{id || jsonUrl}</a>
                    {sizeText}
                  </>
                )
              })()}
            </p>
          ) : null}
        </header>

        {/* Tabs */}
        <div className="mb-4 flex gap-2 border-b border-[color:var(--border)]">
          <button
            onClick={() => setActiveTab('structure')}
            className={`px-4 py-2 font-medium transition flex items-center gap-2 ${
              activeTab === 'structure'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-[color:var(--muted)] hover:text-[color:var(--text)]'
            }`}
          >
            <span>Structure</span>
            {structureCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                {structureCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`px-4 py-2 font-medium transition flex items-center gap-2 ${
              activeTab === 'data'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-[color:var(--muted)] hover:text-[color:var(--text)]'
            }`}
          >
            <span>Data</span>
            {dataKeysCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                {dataKeysCount}
              </span>
            )}
          </button>
        </div>

        <main ref={containerRef} className="rounded-xl border border-[color:var(--border)] bg-white/70 backdrop-blur p-4 shadow-sm">
          {isLoading ? (
            <div className="text-[color:var(--muted)]">Loading data…</div>
          ) : activeTab === 'structure' ? (
            root ? (
              <StructureView root={root} resolveQueryValue={resolveQueryValue} fullJSON={fullJSON} />
            ) : (
              <div className="text-[color:var(--muted)]">No JSON loaded. Pass ?url=…</div>
            )
          ) : (
            fullJSON?.data ? (
              <div>
                {isCalculatingRefs && (
                  <div className="mb-2 text-sm text-blue-600 italic">Calculating referenced items...</div>
                )}
                <DataView data={fullJSON.data} referencedIds={referencedIds} />
              </div>
            ) : (
              <div className="text-[color:var(--muted)]">No data found in JSON</div>
            )
          )}
        </main>
      </div>
    </div>
  )
}

function DataView({ data, referencedIds }: { data: AnyRecord, referencedIds: Set<string> | null }) {
  const [sortBy, setSortBy] = useState<'count' | 'size'>('count')
  const [showOrphansOnly, setShowOrphansOnly] = useState(false)

  const dataEntries = useMemo(() => {
    if (!data || typeof data !== 'object') return []
    return Object.entries(data).map(([key, value]) => {
      let count = 0
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        count = Object.keys(value).length
      } else if (Array.isArray(value)) {
        count = value.length
      }
      const size = estimateSize(value)
      return { key, count, type: Array.isArray(value) ? 'array' : typeof value, value, size }
    }).sort((a, b) => {
      if (sortBy === 'size') {
        return b.size - a.size
      }
      return b.count - a.count
    })
  }, [data, sortBy])

  const totalSize = useMemo(() => {
    return dataEntries.reduce((sum, entry) => sum + entry.size, 0)
  }, [dataEntries])

  // Count total orphans across all data maps
  const totalOrphanStats = useMemo(() => {
    if (!referencedIds) return null
    let totalOrphans = 0
    let totalOrphanSize = 0
    let mapsWithOrphans = 0
    
    for (const { value } of dataEntries) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        let mapOrphans = 0
        let mapOrphanSize = 0
        for (const [key, val] of Object.entries(value)) {
          if (!referencedIds.has(key)) {
            mapOrphans++
            mapOrphanSize += estimateSize(val)
          }
        }
        if (mapOrphans > 0) {
          mapsWithOrphans++
          totalOrphans += mapOrphans
          totalOrphanSize += mapOrphanSize
        }
      }
    }
    return { totalOrphans, totalOrphanSize, mapsWithOrphans }
  }, [referencedIds, dataEntries])

  return (
    <div>
      <div className="mb-3 pb-2 border-b border-[color:var(--border)] flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-sm text-[color:var(--muted)] italic">
            Total estimated size: <span className="font-semibold text-[color:var(--text)]">{formatBytes(totalSize)}</span>
          </span>
          {totalOrphanStats && totalOrphanStats.totalOrphans > 0 && (
            <div className="text-xs text-red-600 mt-1">
              🗑️ {totalOrphanStats.totalOrphans} orphan items ({formatBytes(totalOrphanStats.totalOrphanSize)}) across {totalOrphanStats.mapsWithOrphans} data maps
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {referencedIds && (
            <button
              onClick={() => setShowOrphansOnly(!showOrphansOnly)}
              className={`text-xs px-3 py-1 rounded transition ${
                showOrphansOnly
                  ? 'bg-red-600 text-white'
                  : 'bg-red-100 text-red-700 hover:bg-red-200'
              }`}
            >
              {showOrphansOnly ? '✓ Showing Orphans Only' : 'Show Orphans Only'}
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[color:var(--muted)]">Sort by:</span>
            <button
              onClick={() => setSortBy('count')}
              className={`text-xs px-3 py-1 rounded transition ${
                sortBy === 'count'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Count
            </button>
            <button
              onClick={() => setSortBy('size')}
              className={`text-xs px-3 py-1 rounded transition ${
                sortBy === 'size'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Size
            </button>
          </div>
        </div>
      </div>
      {dataEntries.map(({ key, count, type, value, size }) => {
        // If showing orphans only, check if this data map has any orphans
        if (showOrphansOnly && referencedIds && value && typeof value === 'object' && !Array.isArray(value)) {
          const hasOrphans = Object.keys(value).some(k => !referencedIds.has(k))
          if (!hasOrphans) return null
        }
        return (
          <DataEntry 
            key={key} 
            entryKey={key} 
            count={count} 
            type={type} 
            value={value} 
            data={data} 
            size={size} 
            referencedIds={referencedIds}
            showOrphansOnly={showOrphansOnly}
          />
        )
      })}
    </div>
  )
}

function DataEntry({ entryKey, count, type, value, data, size, referencedIds, showOrphansOnly }: { 
  entryKey: string, 
  count: number, 
  type: string, 
  value: any,
  data: AnyRecord,
  size: number,
  referencedIds: Set<string> | null,
  showOrphansOnly: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showCount, setShowCount] = useState(10)
  const [expandedNestedKey, setExpandedNestedKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const nestedEntries = useMemo(() => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return Object.entries(value)
  }, [value])

  // Calculate orphan stats for this data map
  const orphanStats = useMemo(() => {
    if (!referencedIds || !nestedEntries.length) return null
    let orphanCount = 0
    let orphanSize = 0
    for (const [key, val] of nestedEntries) {
      if (!referencedIds.has(key)) {
        orphanCount++
        orphanSize += estimateSize(val)
      }
    }
    return { orphanCount, orphanSize, totalCount: nestedEntries.length }
  }, [referencedIds, nestedEntries])

  const filteredEntries = useMemo(() => {
    let entries = nestedEntries
    
    // Filter by orphans if enabled
    if (showOrphansOnly && referencedIds) {
      entries = entries.filter(([key]) => !referencedIds.has(key))
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      entries = entries.filter(([key]) => key.toLowerCase().includes(query))
    }
    
    return entries
  }, [nestedEntries, searchQuery, showOrphansOnly, referencedIds])

  const visibleEntries = filteredEntries.slice(0, showCount)
  const hasMore = showCount < filteredEntries.length

  return (
    <details className="group" open={isExpanded} onToggle={(e) => setIsExpanded(e.currentTarget.open)}>
      <summary className="list-none cursor-pointer hover:bg-blue-50/50 transition-colors py-2 px-1">
        <div className="flex items-center gap-2">
          <span className="caret text-sm">{isExpanded ? '▸' : '▸'}</span>
          <span className={`icon ${type === 'object' ? 'folder' : 'file'}`}></span>
          <div className="flex-1 flex items-center gap-3">
            <span className="font-mono text-sm font-medium text-[color:var(--text)]">{entryKey}</span>
            <div className="flex items-center gap-2">
              {count > 0 && (
                <span className="badge text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium" title={`${count} ${type === 'array' ? 'items' : 'keys'}`}>
                  {count}
                </span>
              )}
              {size > 0 && (
                <span className="text-xs text-[color:var(--muted)] font-medium" title={`Estimated size: ${size} bytes`}>
                  {formatBytes(size)}
                </span>
              )}
              {orphanStats && orphanStats.orphanCount > 0 && (
                <span 
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium" 
                  title={`${orphanStats.orphanCount} orphan items (${formatBytes(orphanStats.orphanSize)})`}
                >
                  🗑️ {orphanStats.orphanCount} orphans
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); console.clear(); console.log(entryKey, data[entryKey]); }}
            className="print-btn opacity-0 group-hover:opacity-100 text-base"
            title={`Print ${entryKey} to console`}
          >
            🖨️
          </button>
        </div>
      </summary>
      
      {isExpanded && nestedEntries.length > 0 && (
        <div className="ml-8 mt-1 mb-2">
          <div className="mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowCount(10); }}
              placeholder="Search nested keys..."
              className="w-full px-3 py-1.5 text-xs rounded border border-[color:var(--border)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="mb-2 text-xs text-[color:var(--muted)] italic">
            Showing {visibleEntries.length} from {filteredEntries.length}{searchQuery ? ` (filtered from ${nestedEntries.length} total)` : ''}
          </div>
          <div className="space-y-0.5">
            {visibleEntries.map(([nestedKey, nestedValue]) => {
              const itemType = nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue) 
                ? (nestedValue as AnyRecord).type || (nestedValue as AnyRecord).componentType || typeof nestedValue
                : Array.isArray(nestedValue) ? `[Array(${nestedValue.length})]` : typeof nestedValue
              const isNestedExpanded = expandedNestedKey === nestedKey
              const nestedSize = estimateSize(nestedValue)
              const isOrphan = referencedIds ? !referencedIds.has(nestedKey) : false
              return (
                <details 
                  key={nestedKey}
                  className={`group/nested ${isOrphan ? 'bg-red-50 rounded' : ''}`}
                  open={isNestedExpanded}
                  onToggle={(e) => setExpandedNestedKey(e.currentTarget.open ? nestedKey : null)}
                >
                  <summary className="list-none cursor-pointer hover:bg-blue-50/50 transition-colors py-1.5 px-2 rounded">
                    <div className="flex items-center gap-2">
                      <span className="caret text-sm">{isNestedExpanded ? '▸' : '▸'}</span>
                      <span className="icon file"></span>
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm text-[color:var(--text)] truncate flex items-center gap-2">
                            {nestedKey}
                            {isOrphan && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-red-500 text-white font-medium">ORPHAN</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {itemType}
                          </div>
                        </div>
                        {nestedSize > 0 && (
                          <span className="text-[10px] text-[color:var(--muted)] font-medium whitespace-nowrap" title={`Estimated size: ${nestedSize} bytes`}>
                            {formatBytes(nestedSize)}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); console.clear(); console.log(nestedKey, nestedValue); }}
                        className="print-btn opacity-0 group-hover/nested:opacity-100 text-base"
                        title={`Print ${nestedKey} to console`}
                      >
                        🖨️
                      </button>
                    </div>
                  </summary>
                  {isNestedExpanded && (
                    <div className="ml-8 mt-1 mb-2">
                      <pre className="text-xs overflow-x-auto bg-[#f8f9fa] p-3 rounded border border-[color:var(--border)] max-h-96 overflow-y-auto font-mono leading-relaxed">
                        {JSON.stringify(nestedValue, null, 2)}
                      </pre>
                    </div>
                  )}
                </details>
              )
            })}
          </div>
          {filteredEntries.length > 10 && (
            <div className="mt-2 flex gap-2">
              {hasMore ? (
                <>
                  <button
                    onClick={(e) => { e.preventDefault(); setShowCount(prev => prev + 10); }}
                    className="flex-1 px-2 py-1.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition font-medium"
                  >
                    Load more ({filteredEntries.length - showCount} remaining)
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); setShowCount(filteredEntries.length); }}
                    className="px-3 py-1.5 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition font-medium"
                  >
                    Show All
                  </button>
                </>
              ) : (
                <button
                  onClick={(e) => { e.preventDefault(); setShowCount(10); }}
                  className="w-full px-2 py-1.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition font-medium"
                >
                  Hide All
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </details>
  )
}

// Helper to calculate total size of an item including all nested refs (recursive)
function getTotalItemSize(item: QueryItemDetail): number {
  let total = item.size
  if (item.nestedRefs) {
    for (const ref of item.nestedRefs) {
      total += getTotalItemSize(ref)
    }
  }
  return total
}

// Color palette for pie chart segments
const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7', '#eab308', '#22c55e', '#0ea5e9',
  '#d946ef', '#64748b', '#78716c', '#71717a', '#737373'
]

// Pie Chart Component
function PieChart({ data, size = 200 }: { data: Array<{ label: string; value: number; color: string }>; size?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) return null
  
  let currentAngle = -90 // Start from top
  const radius = size / 2
  const center = size / 2
  
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((segment, idx) => {
        const percentage = segment.value / total
        const angle = percentage * 360
        const startAngle = currentAngle
        const endAngle = currentAngle + angle
        currentAngle = endAngle
        
        // Calculate arc path
        const startRad = (startAngle * Math.PI) / 180
        const endRad = (endAngle * Math.PI) / 180
        
        const x1 = center + radius * Math.cos(startRad)
        const y1 = center + radius * Math.sin(startRad)
        const x2 = center + radius * Math.cos(endRad)
        const y2 = center + radius * Math.sin(endRad)
        
        const largeArc = angle > 180 ? 1 : 0
        
        const pathD = percentage >= 0.9999 
          ? `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center - 0.001} ${center - radius} Z`
          : `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
        
        return (
          <path
            key={idx}
            d={pathD}
            fill={segment.color}
            stroke="white"
            strokeWidth="2"
          >
            <title>{segment.label}: {formatBytes(segment.value)} ({(percentage * 100).toFixed(1)}%)</title>
          </path>
        )
      })}
      {/* Center hole for donut effect */}
      <circle cx={center} cy={center} r={radius * 0.5} fill="white" />
      <text x={center} y={center} textAnchor="middle" dominantBaseline="middle" className="text-lg font-bold fill-gray-800">
        {formatBytes(total)}
      </text>
    </svg>
  )
}

// Recursive expandable item component
function ExpandableQueryItem({ item, depth = 0, expandedItems, toggleExpand }: {
  item: QueryItemDetail
  depth?: number
  expandedItems: Set<string>
  toggleExpand: (id: string) => void
}) {
  const itemKey = `${item.componentPath}-${item.id}-${depth}`
  const isExpanded = expandedItems.has(itemKey)
  const hasNested = item.nestedRefs && item.nestedRefs.length > 0
  const totalNestedSize = useMemo(() => getTotalItemSize(item) - item.size, [item])
  const nestedCount = useMemo(() => {
    let count = 0
    const countNested = (refs: QueryItemDetail[] | undefined) => {
      if (!refs) return
      count += refs.length
      refs.forEach(r => countNested(r.nestedRefs))
    }
    countNested(item.nestedRefs)
    return count
  }, [item])
  
  return (
    <div style={{ marginLeft: depth > 0 ? '16px' : '0' }}>
      <div 
        className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-gray-50 ${hasNested ? '' : 'opacity-80'}`}
        onClick={() => hasNested && toggleExpand(itemKey)}
      >
        {hasNested ? (
          <span className="text-xs w-4">{isExpanded ? '▼' : '▶'}</span>
        ) : (
          <span className="w-4" />
        )}
        <span className="font-mono text-xs text-gray-600 truncate flex-1" title={item.id}>{item.id}</span>
        <span className="text-xs text-emerald-600 font-medium">{formatBytes(item.size)}</span>
        {hasNested && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
            +{nestedCount} ({formatBytes(totalNestedSize)})
          </span>
        )}
      </div>
      {isExpanded && item.nestedRefs && (
        <div className="border-l-2 border-gray-200 ml-2">
          {item.nestedRefs.map((ref, idx) => (
            <ExpandableQueryItem
              key={`${ref.id}-${idx}`}
              item={ref}
              depth={depth + 1}
              expandedItems={expandedItems}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Reference Tree Item - shows the path of references with visual tree lines
function ReferenceTreeItem({ item, depth, expandedItems, toggleExpand, parentKey = '' }: {
  item: QueryItemDetail
  depth: number
  expandedItems: Set<string>
  toggleExpand: (id: string) => void
  parentKey?: string
}) {
  const itemKey = `tree-${parentKey}-${item.id}-${depth}`
  const isExpanded = expandedItems.has(itemKey)
  const hasNested = item.nestedRefs && item.nestedRefs.length > 0
  
  // Calculate total size including all nested refs recursively
  const totalSize = useMemo(() => getTotalItemSize(item), [item])
  
  // Count all nested refs recursively
  const nestedCount = useMemo(() => {
    let count = 0
    const countNested = (refs: QueryItemDetail[] | undefined) => {
      if (!refs) return
      count += refs.length
      refs.forEach(r => countNested(r.nestedRefs))
    }
    countNested(item.nestedRefs)
    return count
  }, [item])
  
  return (
    <div className="relative">
      {/* Tree connector line */}
      {depth > 0 && (
        <div 
          className="absolute left-0 top-0 bottom-0 border-l-2 border-gray-200"
          style={{ left: '-8px' }}
        />
      )}
      
      <div 
        className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-blue-50 transition`}
        onClick={() => hasNested && toggleExpand(itemKey)}
      >
        {hasNested ? (
          <span className="text-xs text-blue-500 w-4 flex-shrink-0">{isExpanded ? '▼' : '▶'}</span>
        ) : (
          <span className="text-xs text-gray-300 w-4 flex-shrink-0">─</span>
        )}
        
        <code className="text-xs text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded truncate" title={item.id}>
          {item.id}
        </code>
        
        {/* Show TOTAL size (including all nested) */}
        <span className="text-xs text-emerald-600 font-semibold flex-shrink-0">{formatBytes(totalSize)}</span>
        
        {/* Show breakdown if has nested refs */}
        {hasNested && (
          <span className="text-[10px] text-gray-400 flex-shrink-0">
            (self: {formatBytes(item.size)} + {nestedCount} nested)
          </span>
        )}
      </div>
      
      {isExpanded && item.nestedRefs && (
        <div className="ml-6 pl-2 border-l-2 border-blue-200">
          {item.nestedRefs.length > 1 && (
            <div className="text-[10px] text-purple-600 py-1 px-2 bg-purple-50 rounded mb-1">
              References {item.nestedRefs.length} items:
            </div>
          )}
          {item.nestedRefs
            .sort((a, b) => getTotalItemSize(b) - getTotalItemSize(a))
            .map((ref, idx) => (
              <ReferenceTreeItem
                key={`${ref.id}-${idx}`}
                item={ref}
                depth={depth + 1}
                expandedItems={expandedItems}
                toggleExpand={toggleExpand}
                parentKey={itemKey}
              />
            ))
          }
        </div>
      )}
    </div>
  )
}

// Tab type for the breakdown panel
type BreakdownTab = 'size' | 'coverage' | 'breakdown'

// Breakdown Panel Component (Modal style) - Uses portal to render at body level
function BreakdownPanel({ result, onClose, fullJSON }: { result: QuerySizeResult, onClose: () => void, fullJSON: AnyRecord | null }) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [expandedQueryTypes, setExpandedQueryTypes] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<BreakdownTab>('size')
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  
  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  
  const toggleQueryType = (type: string) => {
    setExpandedQueryTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }
  
  // Sorted query types by size (for pie chart and legend)
  const sortedQueryTypes = useMemo(() => {
    return Object.entries(result.breakdown)
      .map(([type, size], idx) => ({
        type,
        size,
        color: CHART_COLORS[idx % CHART_COLORS.length],
        percentage: (size / result.totalSize) * 100,
        items: result.details.filter(d => d.queryType === type)
      }))
      .sort((a, b) => b.size - a.size)
  }, [result])
  
  // Pie chart data
  const pieData = useMemo(() => {
    return sortedQueryTypes.map(q => ({
      label: q.type,
      value: q.size,
      color: q.color
    }))
  }, [sortedQueryTypes])
  
  // Coverage data
  const coverageData = useMemo(() => {
    if (!fullJSON?.data) return []
    const getAllReferencedIds = (items: QueryItemDetail[]): Set<string> => {
      const ids = new Set<string>()
      const collect = (list: QueryItemDetail[]) => {
        for (const item of list) {
          ids.add(item.id)
          if (item.nestedRefs) collect(item.nestedRefs)
        }
      }
      collect(items)
      return ids
    }
    const referencedIds = getAllReferencedIds(result.details)
    const dataMapToQueryType: Record<string, string> = {}
    for (const [qt, dm] of Object.entries(DATA_MAP_MAPPINGS)) {
      dataMapToQueryType[dm] = qt
    }
    const coverage: Array<{ dataMap: string; queryType: string; totalItems: number; totalSize: number; referencedItems: number; referencedSize: number; coverage: number }> = []
    for (const [mapKey, mapData] of Object.entries(fullJSON.data as Record<string, any>)) {
      if (!mapData || typeof mapData !== 'object' || Array.isArray(mapData)) continue
      const allKeys = Object.keys(mapData)
      if (allKeys.length === 0) continue
      let totalSize = 0, referencedItems = 0, referencedSize = 0
      for (const key of allKeys) {
        const itemSize = estimateSize(mapData[key])
        totalSize += itemSize
        if (referencedIds.has(key)) { referencedItems++; referencedSize += itemSize }
      }
      coverage.push({ dataMap: mapKey, queryType: dataMapToQueryType[mapKey] || mapKey, totalItems: allKeys.length, totalSize, referencedItems, referencedSize, coverage: Math.round((referencedItems / allKeys.length) * 100) })
    }
    return coverage.sort((a, b) => b.totalSize - a.totalSize)
  }, [fullJSON, result.details])
  
  const modalContent = (
    <>
      {/* Overlay */}
      <div 
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          zIndex: 9999
        }}
      />
      {/* Panel */}
      <div 
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: '900px',
          maxHeight: '90vh',
          backgroundColor: 'white',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
      {/* Header with Total Size */}
      <div style={{ 
        padding: '20px 24px 16px', 
        background: 'linear-gradient(to right, #f8fafc, #f1f5f9)'
      }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-800">Query Size Breakdown</h3>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-3xl font-bold text-emerald-600">{formatBytes(result.totalSize)}</span>
              <span className="text-sm text-gray-500">{result.details.length} query items</span>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl font-bold"
          >
            ×
          </button>
        </div>
      </div>
      
      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-4 bg-gray-50">
        {[
          { id: 'size' as BreakdownTab, label: '📊 Query Size', icon: '' },
          { id: 'coverage' as BreakdownTab, label: '📈 Coverage', icon: '' },
          { id: 'breakdown' as BreakdownTab, label: '🔍 Breakdown', icon: '' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === tab.id 
                ? 'border-blue-600 text-blue-600 bg-white' 
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'size' && (
          /* Query Size Tab - Pie Chart + Legend */
          <div style={{ padding: '24px' }}>
            <div className="flex items-start gap-8">
              {/* Pie Chart */}
              <div className="flex-shrink-0">
                <PieChart data={pieData} size={200} />
              </div>
              
              {/* Legend - sorted by size */}
              <div className="flex-1">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">By Query Type</div>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {sortedQueryTypes.map(q => (
                    <div 
                      key={q.type}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 transition"
                    >
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: q.color }} />
                      <span className="text-sm font-medium text-gray-700 flex-1">{q.type}</span>
                      <span className="text-sm text-gray-400">{q.items.length} items</span>
                      <span className="text-sm font-semibold text-emerald-600 w-20 text-right">{formatBytes(q.size)}</span>
                      <span className="text-xs text-gray-400 w-14 text-right">({q.percentage.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'coverage' && (
          /* Coverage Tab */
          <div style={{ padding: '16px 24px' }}>
            <p className="text-sm text-gray-500 mb-4">
              Comparing referenced data vs total data in each map. Low coverage indicates potential orphaned data.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-medium text-gray-600">Data Map</th>
                  <th className="text-right py-2 font-medium text-gray-600">Total</th>
                  <th className="text-right py-2 font-medium text-gray-600">Referenced</th>
                  <th className="text-right py-2 font-medium text-gray-600">Orphans</th>
                  <th className="text-right py-2 font-medium text-gray-600">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {coverageData.map(item => {
                  const orphanItems = item.totalItems - item.referencedItems
                  const orphanSize = item.totalSize - item.referencedSize
                  const coverageColor = item.coverage >= 80 ? 'text-emerald-600' : item.coverage >= 50 ? 'text-yellow-600' : 'text-red-600'
                  return (
                    <tr key={item.dataMap} className="border-b hover:bg-gray-50">
                      <td className="py-2"><div className="font-medium">{item.dataMap}</div><div className="text-xs text-gray-400">{item.queryType}</div></td>
                      <td className="text-right py-2"><div>{item.totalItems}</div><div className="text-xs text-gray-400">{formatBytes(item.totalSize)}</div></td>
                      <td className="text-right py-2 text-emerald-600"><div>{item.referencedItems}</div><div className="text-xs">{formatBytes(item.referencedSize)}</div></td>
                      <td className="text-right py-2 text-red-500"><div>{orphanItems}</div><div className="text-xs">{formatBytes(orphanSize)}</div></td>
                      <td className={`text-right py-2 font-bold ${coverageColor}`}>{item.coverage}%</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-medium bg-gray-50">
                  <td className="py-2">TOTAL</td>
                  <td className="text-right py-2"><div>{coverageData.reduce((s, i) => s + i.totalItems, 0)}</div><div className="text-xs text-gray-400">{formatBytes(coverageData.reduce((s, i) => s + i.totalSize, 0))}</div></td>
                  <td className="text-right py-2 text-emerald-600"><div>{coverageData.reduce((s, i) => s + i.referencedItems, 0)}</div><div className="text-xs">{formatBytes(coverageData.reduce((s, i) => s + i.referencedSize, 0))}</div></td>
                  <td className="text-right py-2 text-red-500"><div>{coverageData.reduce((s, i) => s + i.totalItems - i.referencedItems, 0)}</div><div className="text-xs">{formatBytes(coverageData.reduce((s, i) => s + i.totalSize - i.referencedSize, 0))}</div></td>
                  <td className="text-right py-2">{Math.round((coverageData.reduce((s, i) => s + i.referencedItems, 0) / Math.max(1, coverageData.reduce((s, i) => s + i.totalItems, 0))) * 100)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        
        {activeTab === 'breakdown' && (
          /* Breakdown Tab - Full Component Tree with Children first, then Queries */
          <div className="p-4">
            {(() => {
              // Build component tree from details
              type ComponentNode = {
                name: string
                path: string
                queries: QueryItemDetail[]
                children: ComponentNode[]
                totalSize: number
              }
              
              // Group details by component path
              const byPath: Record<string, QueryItemDetail[]> = {}
              for (const d of result.details) {
                if (!byPath[d.componentPath]) byPath[d.componentPath] = []
                byPath[d.componentPath].push(d)
              }
              
              // Find root path (shortest)
              const rootPath = Object.keys(byPath).reduce((shortest, p) => 
                !shortest || p.length < shortest.length ? p : shortest
              , '')
              
              // Build tree structure
              const buildTree = (parentPath: string): ComponentNode[] => {
                const children: ComponentNode[] = []
                for (const [path, queries] of Object.entries(byPath)) {
                  // Check if this path is a direct child of parentPath
                  if (path !== parentPath && path.startsWith(parentPath + ' > ')) {
                    const remainder = path.slice(parentPath.length + 3) // remove " > "
                    // Only direct children (no more " > " in remainder)
                    if (!remainder.includes(' > ')) {
                      const childSize = queries.reduce((s, q) => s + getTotalItemSize(q), 0)
                      const childNode: ComponentNode = {
                        name: remainder,
                        path: path,
                        queries: queries,
                        children: buildTree(path),
                        totalSize: childSize
                      }
                      // Add children's sizes
                      const addChildrenSize = (node: ComponentNode): number => {
                        let size = node.queries.reduce((s, q) => s + getTotalItemSize(q), 0)
                        for (const child of node.children) {
                          size += addChildrenSize(child)
                        }
                        return size
                      }
                      childNode.totalSize = addChildrenSize(childNode)
                      children.push(childNode)
                    }
                  }
                }
                return children.sort((a, b) => b.totalSize - a.totalSize)
              }
              
              const rootQueries = byPath[rootPath] || []
              const rootChildren = buildTree(rootPath)
              const rootQueriesSize = rootQueries.reduce((s, q) => s + getTotalItemSize(q), 0)
              const childrenTotalSize = rootChildren.reduce((s, c) => s + c.totalSize, 0)
              
              // Recursive component renderer
              const renderComponentNode = (node: ComponentNode, depth: number): React.ReactNode => {
                const nodeKey = `comp-${node.path}`
                const isExpanded = expandedItems.has(nodeKey)
                const hasChildren = node.children.length > 0
                const hasQueries = node.queries.length > 0
                
                // Group queries by type
                const queryByType: Record<string, QueryItemDetail[]> = {}
                for (const q of node.queries) {
                  if (!queryByType[q.queryType]) queryByType[q.queryType] = []
                  queryByType[q.queryType].push(q)
                }
                
                return (
                  <div key={node.path} style={{ marginLeft: depth > 0 ? '16px' : '0' }}>
                    <div 
                      onClick={() => toggleExpand(nodeKey)}
                      className="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-blue-50 transition"
                    >
                      <span className="text-xs text-blue-500 w-4">{isExpanded ? '▼' : '▶'}</span>
                      <span className="text-sm">📦</span>
                      <span className="font-medium text-gray-800">{node.name}</span>
                      <span className="text-xs text-gray-400">
                        {hasChildren && `${node.children.length} children`}
                        {hasChildren && hasQueries && ', '}
                        {hasQueries && `${node.queries.length} queries`}
                      </span>
                      <span className="flex-1" />
                      <span className="font-semibold text-emerald-600">{formatBytes(node.totalSize)}</span>
                    </div>
                    
                    {isExpanded && (
                      <div className="ml-4 border-l-2 border-blue-100 pl-2">
                        {/* Children first */}
                        {node.children.map(child => renderComponentNode(child, depth + 1))}
                        
                        {/* Then queries */}
                        {Object.entries(queryByType)
                          .sort((a, b) => {
                            const sizeA = a[1].reduce((s, i) => s + getTotalItemSize(i), 0)
                            const sizeB = b[1].reduce((s, i) => s + getTotalItemSize(i), 0)
                            return sizeB - sizeA
                          })
                          .map(([queryType, items]) => {
                            const typeKey = `${node.path}-type-${queryType}`
                            const isTypeExpanded = expandedItems.has(typeKey)
                            const typeTotalSize = items.reduce((s, i) => s + getTotalItemSize(i), 0)
                            const color = sortedQueryTypes.find(q => q.type === queryType)?.color || '#888'
                            
                            return (
                              <div key={queryType} className="mt-1">
                                <div 
                                  onClick={(e) => { e.stopPropagation(); toggleExpand(typeKey) }}
                                  className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-50"
                                >
                                  <span className="text-xs text-gray-400 w-4">{isTypeExpanded ? '▼' : '▶'}</span>
                                  <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                                  <span className="text-sm text-gray-700">{queryType}</span>
                                  <span className="text-xs text-gray-400">{items.length}</span>
                                  <span className="flex-1" />
                                  <span className="text-sm font-medium text-emerald-600">{formatBytes(typeTotalSize)}</span>
                                </div>
                                
                                {isTypeExpanded && (
                                  <div className="ml-6 pl-2 border-l border-gray-200">
                                    {items
                                      .sort((a, b) => getTotalItemSize(b) - getTotalItemSize(a))
                                      .map((item, idx) => (
                                        <ReferenceTreeItem
                                          key={`${item.id}-${idx}`}
                                          item={item}
                                          depth={0}
                                          expandedItems={expandedItems}
                                          toggleExpand={toggleExpand}
                                        />
                                      ))
                                    }
                                  </div>
                                )}
                              </div>
                            )
                          })
                        }
                      </div>
                    )}
                  </div>
                )
              }
              
              // Group root queries by type
              const rootQueryByType: Record<string, QueryItemDetail[]> = {}
              for (const q of rootQueries) {
                if (!rootQueryByType[q.queryType]) rootQueryByType[q.queryType] = []
                rootQueryByType[q.queryType].push(q)
              }
              
              return (
                <>
                  <div className="text-xs text-gray-500 mb-2">
                    Full breakdown for <span className="font-semibold text-gray-700">{rootPath}</span>
                  </div>
                  <div className="text-xs text-gray-400 mb-3">
                    Expand children to see all queries. Children are shown first, then the component's own queries.
                  </div>
                  <div className="border rounded-lg overflow-hidden bg-white max-h-[500px] overflow-y-auto">
                    {/* Children section first */}
                    {rootChildren.length > 0 && (
                      <div className="border-b">
                        <div 
                          onClick={() => toggleExpand('root-children')}
                          className="px-3 py-2.5 cursor-pointer hover:bg-gray-50 flex items-center gap-3 bg-blue-50"
                        >
                          <span className="text-sm w-4">{expandedItems.has('root-children') ? '▼' : '▶'}</span>
                          <span className="text-lg">👶</span>
                          <span className="font-medium text-gray-800">Children</span>
                          <span className="text-xs text-gray-500">{rootChildren.length} components</span>
                          <span className="flex-1" />
                          <span className="font-semibold text-emerald-600">{formatBytes(childrenTotalSize)}</span>
                        </div>
                        
                        {expandedItems.has('root-children') && (
                          <div className="px-2 py-2 bg-gray-50">
                            {rootChildren.map(child => renderComponentNode(child, 0))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Root's own queries section */}
                    {rootQueries.length > 0 && (
                      <div>
                        <div 
                          onClick={() => toggleExpand('root-queries')}
                          className="px-3 py-2.5 cursor-pointer hover:bg-gray-50 flex items-center gap-3 bg-purple-50"
                        >
                          <span className="text-sm w-4">{expandedItems.has('root-queries') ? '▼' : '▶'}</span>
                          <span className="text-lg">📊</span>
                          <span className="font-medium text-gray-800">Own Queries</span>
                          <span className="text-xs text-gray-500">{rootQueries.length} queries</span>
                          <span className="flex-1" />
                          <span className="font-semibold text-emerald-600">{formatBytes(rootQueriesSize)}</span>
                        </div>
                        
                        {expandedItems.has('root-queries') && (
                          <div className="px-2 py-2 bg-gray-50">
                            {Object.entries(rootQueryByType)
                              .sort((a, b) => {
                                const sizeA = a[1].reduce((s, i) => s + getTotalItemSize(i), 0)
                                const sizeB = b[1].reduce((s, i) => s + getTotalItemSize(i), 0)
                                return sizeB - sizeA
                              })
                              .map(([queryType, items]) => {
                                const typeKey = `root-own-type-${queryType}`
                                const isTypeExpanded = expandedItems.has(typeKey)
                                const typeTotalSize = items.reduce((s, i) => s + getTotalItemSize(i), 0)
                                const color = sortedQueryTypes.find(q => q.type === queryType)?.color || '#888'
                                
                                return (
                                  <div key={queryType} className="mt-1 first:mt-0">
                                    <div 
                                      onClick={() => toggleExpand(typeKey)}
                                      className="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-white"
                                    >
                                      <span className="text-xs text-gray-400 w-4">{isTypeExpanded ? '▼' : '▶'}</span>
                                      <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                                      <span className="text-sm font-medium text-gray-700">{queryType}</span>
                                      <span className="text-xs text-gray-400">{items.length}</span>
                                      <span className="flex-1" />
                                      <span className="text-sm font-semibold text-emerald-600">{formatBytes(typeTotalSize)}</span>
                                    </div>
                                    
                                    {isTypeExpanded && (
                                      <div className="ml-6 pl-2 border-l border-gray-200">
                                        {items
                                          .sort((a, b) => getTotalItemSize(b) - getTotalItemSize(a))
                                          .map((item, idx) => (
                                            <ReferenceTreeItem
                                              key={`${item.id}-${idx}`}
                                              item={item}
                                              depth={0}
                                              expandedItems={expandedItems}
                                              toggleExpand={toggleExpand}
                                            />
                                          ))
                                        }
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            }
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        )}
      </div>
      </div>
    </>
  )
  
  // Use portal to render at document body level for proper fixed positioning
  if (!mounted) return null
  return createPortal(modalContent, document.body)
}

// Global event for showing breakdown panel (used by vanilla DOM child nodes)
const BREAKDOWN_EVENT = 'showQueryBreakdown'

// Wrapper component that manages breakdown panel state
function StructureView({ root, resolveQueryValue, fullJSON }: { root: AnyRecord, resolveQueryValue: (k: string, v: any) => any, fullJSON: AnyRecord | null }) {
  const [breakdownResult, setBreakdownResult] = useState<QuerySizeResult | null>(null)
  
  // Listen for custom events from vanilla DOM child nodes
  useEffect(() => {
    const handler = (e: CustomEvent<QuerySizeResult>) => {
      setBreakdownResult(e.detail)
    }
    window.addEventListener(BREAKDOWN_EVENT, handler as EventListener)
    return () => window.removeEventListener(BREAKDOWN_EVENT, handler as EventListener)
  }, [])
  
  return (
    <>
      <TreeRoot 
        data={root} 
        resolveQueryValue={resolveQueryValue} 
        fullJSON={fullJSON} 
        onShowBreakdown={setBreakdownResult}
      />
      {breakdownResult && (
        <BreakdownPanel result={breakdownResult} onClose={() => setBreakdownResult(null)} fullJSON={fullJSON} />
      )}
    </>
  )
}

function TreeRoot({ data, resolveQueryValue, fullJSON, onShowBreakdown }: { data: AnyRecord, resolveQueryValue: (k: string, v: any) => any, fullJSON: AnyRecord | null, onShowBreakdown: (result: QuerySizeResult) => void }) {
  const rootRef = useRef<HTMLDetailsElement>(null)
  const [querySize, setQuerySize] = useState<string | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [lastResult, setLastResult] = useState<QuerySizeResult | null>(null)
  
  const handleCalculate = useCallback(() => {
    if (!fullJSON) {
      setQuerySize('No data')
      return
    }
    setIsCalculating(true)
    setQuerySize('Calculating...')
    
    setTimeout(() => {
      try {
        const result = calculateTotalQuerySize(data, fullJSON, resolveQueryValue)
        const sizeText = formatBytes(result.totalSize)
        setQuerySize(sizeText)
        setLastResult(result)
        
        // Show breakdown in console
        const { id } = getNodeLabel(data)
        console.group(`Query Size for ${id}`)
        console.log('Total:', sizeText)
        console.log('Breakdown:', result.breakdown)
        console.log('Details:', result.details)
        console.groupEnd()
      } catch (error) {
        console.error('Error calculating query size:', error)
        setQuerySize('Error')
      }
      setIsCalculating(false)
    }, 10)
  }, [data, fullJSON, resolveQueryValue])
  
  return (
    <details ref={rootRef} open data-path="root">
      <summary style={{ listStyle: 'none' }}>
        <span className="indent"></span>
        <span className="caret">▸</span>
        <span className="icon folder" />
        <span className="bullet" />
        <NodeHeader node={data} resolveQueryValue={resolveQueryValue} />
        {hasChildren(data) ? (
          <span className="badge" title={`${getDescendantCount(data)} total descendants`}>{getDescendantCount(data)}</span>
        ) : null}
        <button
          className="print-btn"
          style={{ marginLeft: '4px' }}
          title="Calculate total query size (this component + all children)"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleCalculate(); }}
          disabled={isCalculating}
        >
          {isCalculating ? '⏳' : '📊'}
        </button>
        {querySize && (
          <span 
            style={{ 
              fontSize: '11px', 
              marginLeft: '6px', 
              color: querySize === 'Error' ? '#dc2626' : querySize === 'Calculating...' ? '#6b7280' : '#059669',
              fontWeight: 600,
              fontStyle: querySize === 'Calculating...' ? 'italic' : 'normal',
              cursor: lastResult ? 'pointer' : 'default',
              textDecoration: lastResult ? 'underline' : 'none'
            }}
            onClick={(e) => { 
              e.stopPropagation()
              if (lastResult) onShowBreakdown(lastResult)
            }}
            title={lastResult ? 'Click to view breakdown' : ''}
          >
            {querySize}
          </span>
        )}
      </summary>
      {/* Children are injected directly under the root details (no extra wrapper) */}
      <ChildrenHydrator parentRef={rootRef} node={data} path="root" depth={0} resolveQueryValue={resolveQueryValue} fullJSON={fullJSON} />
    </details>
  )
}

function NodeHeader({ node, resolveQueryValue }: { node: AnyRecord, resolveQueryValue: (k: string, v: any) => any }) {
  const { id, type } = getNodeLabel(node)
  let displayId = id
  try {
    if (node) {
      let namingName: string | null = null
      if (typeof node.namingQuery === 'string') {
        const resolvedNaming = resolveQueryValue('namingQuery', node.namingQuery)
        if (resolvedNaming && typeof resolvedNaming === 'object' && !Array.isArray(resolvedNaming) && typeof resolvedNaming.name === 'string' && resolvedNaming.name.trim()) {
          namingName = resolvedNaming.name.trim()
        }
      } else if (node.namingQuery && typeof node.namingQuery === 'object' && typeof node.namingQuery.name === 'string') {
        namingName = node.namingQuery.name.trim()
      }
      if (namingName) displayId = `${id} (${namingName})`
    }
  } catch {}
  return (
    <div className="text-container">
      <div className="label">{displayId}</div>
      {type ? <div className="meta">{type}</div> : null}
    </div>
  )
}

function LazyChildren({ node, path, depth, resolveQueryValue }: { node: AnyRecord, path: string, depth: number, resolveQueryValue: (k: string, v: any) => any }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const hydratedRef = useRef(false)

  const hydrate = useCallback(() => {
    const el = detailsRef.current
    if (!el || hydratedRef.current) return
    const sortedChildren = getChildren(node).slice().sort((a, b) => getDescendantCount(b) - getDescendantCount(a))
    for (let i = 0; i < sortedChildren.length; i++) {
      const child = sortedChildren[i]
      const childPath = `${path}/${i}`
      const hasGrand = hasChildren(child)
      const childEl = document.createElement('details')
      childEl.setAttribute('data-path', childPath)
      const summary = document.createElement('summary')
      summary.style.listStyle = 'none'

      const indent = document.createElement('span')
      indent.className = 'indent'
      indent.textContent = '    '.repeat(depth + 1)
      summary.appendChild(indent)

      const caret = document.createElement('span')
      caret.className = 'caret'
      caret.textContent = '▸'
      summary.appendChild(caret)

      const icon = document.createElement('span')
      icon.className = hasGrand ? 'icon folder' : 'icon file'
      summary.appendChild(icon)

      const bullet = document.createElement('span')
      bullet.className = 'bullet'
      summary.appendChild(bullet)

      // Compose React header into a span container
      const textContainer = document.createElement('span')
      textContainer.className = 'text-container'
      // Render via inline React: use a temporary root
      // Simpler: just set text (no nested structure) to avoid double trees
      const { id, type } = getNodeLabel(child)
      textContainer.innerHTML = `<div class="label">${id}</div>${type ? `<div class="meta">${type}</div>` : ''}`
      summary.appendChild(textContainer)

      // Badge
      const totalCount = getDescendantCount(child)
      if (totalCount > 0) {
        const count = document.createElement('span')
        count.className = 'badge'
        count.textContent = String(totalCount)
        count.title = `${totalCount} total descendants`
        summary.appendChild(count)
      }

      // Print button
      const printBtn = document.createElement('button')
      printBtn.className = 'print-btn'
      printBtn.textContent = '🖨️'
      printBtn.title = 'Print this item to console'
      printBtn.addEventListener('click', (e) => { e.stopPropagation(); console.log(child) })
      summary.appendChild(printBtn)

      childEl.appendChild(summary)
    
      // Structure section
      const structureProps = Object.entries(child).filter(([key]) => key !== 'children' && key !== 'components')
      if (structureProps.length > 0) {
        const structureDetails = document.createElement('details')
        structureDetails.className = 'section-details structure-section'
        const structureSummary = document.createElement('summary')
        structureSummary.className = 'section-summary'
        // match app.js visual indent for the section border
        const leftOffsetPx = depth * 16 + 32
        structureDetails.style.marginLeft = `${leftOffsetPx}px`
        const structureIcon = document.createElement('span')
        structureIcon.className = 'section-icon'
        structureIcon.textContent = '⚙️'
        structureSummary.appendChild(structureIcon)
        const structureText = document.createTextNode(` structure (${structureProps.length} properties)`)
        structureSummary.appendChild(structureText)
        structureDetails.appendChild(structureSummary)
        const structureContainer = document.createElement('div')
        structureContainer.className = 'structure section-content'
        for (const [key, value] of structureProps) {
          const propSection = document.createElement('div')
          propSection.className = 'property-section'
          const propKey = document.createElement('span')
          propKey.className = 'property-key'
          propKey.textContent = key + ':'
          propSection.appendChild(propKey)
          const resolvedValue = key.endsWith('Query') ? resolveQueryValue(key, value) : value
          const isResolved = resolvedValue !== value
          const span = document.createElement('span')
          span.className = 'property-value'
          if (resolvedValue === null || resolvedValue === undefined) {
            span.classList.add('null')
            span.textContent = String(resolvedValue)
          } else if (resolvedValue && typeof resolvedValue === 'object' && (resolvedValue as any).__unresolved) {
            span.classList.add('null', 'unresolved')
            span.textContent = `null (${(resolvedValue as any).originalQuery})`
            span.title = `Query not found in data map: ${(resolvedValue as any).originalQuery}`
          } else if (typeof resolvedValue === 'object' && !Array.isArray(resolvedValue)) {
            const objDetails = document.createElement('details')
            objDetails.className = 'property-object'
            const objSummary = document.createElement('summary')
            objSummary.className = 'property-value object-summary'
            objSummary.textContent = `{...} (${Object.keys(resolvedValue).length} properties)` + (isResolved ? ` [resolved]` : '')
            objDetails.appendChild(objSummary)
            const objContent = document.createElement('div')
            objContent.className = 'object-properties'
            for (const [objKey, objValue] of Object.entries(resolvedValue)) {
              const objProp = document.createElement('div')
              objProp.className = 'nested-property'
              const objPropKey = document.createElement('span')
              objPropKey.className = 'property-key nested'
              objPropKey.textContent = objKey + ':'
              objProp.appendChild(objPropKey)
              const objPropValue = document.createElement('span')
              objPropValue.className = 'property-value'
              objPropValue.textContent = typeof objValue === 'object' ? (Array.isArray(objValue) ? `[Array(${(objValue as any[]).length})]` : '{Object}') : String(objValue)
              objProp.appendChild(objPropValue)
              objContent.appendChild(objProp)
            }
            objDetails.appendChild(objContent)
            propSection.appendChild(objDetails)
            structureContainer.appendChild(propSection)
            continue
          } else if (Array.isArray(resolvedValue)) {
            span.classList.add('array')
            span.textContent = `[Array(${resolvedValue.length})]`
            if (isResolved) span.textContent += ' [resolved]'
          } else {
            span.classList.add(typeof resolvedValue)
            span.textContent = String(resolvedValue)
          }
          propSection.appendChild(span)
          structureContainer.appendChild(propSection)
        }
        // Container should be inside details so it opens only when clicking the summary
        structureDetails.appendChild(structureContainer)
        childEl.appendChild(structureDetails)
      }

      childEl.addEventListener('toggle', () => {
        if (childEl.open) {
          // hydrate grandchildren on demand
          // no-op; grandchildren will hydrate when their details open
        } else {
          // prune any nested details to free DOM
          const nested = childEl.querySelectorAll(':scope > details[data-path]')
          nested.forEach(n => n.remove())
        }
      })

      detailsRef.current?.appendChild(childEl)
    }
    hydratedRef.current = true
  }, [node, path, depth, resolveQueryValue])

  const onToggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const el = e.currentTarget
    if (el.open) {
      hydrate()
    } else {
      // prune children
      const nested = el.querySelectorAll(':scope > details[data-path]')
      nested.forEach(n => n.remove())
      hydratedRef.current = false
    }
  }, [hydrate])

  return (
    <details ref={detailsRef} data-path={path} onToggle={onToggle}>
      {/* children are injected dynamically for lazy hydration */}
    </details>
  )
}


// Hydrates children directly under a given parent <details>, mirroring app.js
function ChildrenHydrator({ parentRef, node, path, depth, resolveQueryValue, fullJSON }: { parentRef: RefObject<HTMLDetailsElement> | MutableRefObject<HTMLDetailsElement | null>, node: AnyRecord, path: string, depth: number, resolveQueryValue: (k: string, v: any) => any, fullJSON: AnyRecord | null }) {
  const hydratedRef = useRef(false)
  const pruneChildren = useCallback((container: HTMLElement | null) => {
    if (!container) return
    const nested = container.querySelectorAll(':scope > details[data-path]')
    nested.forEach(n => n.remove())
  }, [])

  const hydrate = useCallback(() => {
    const parent = parentRef.current
    if (!parent || hydratedRef.current) return
    const INDENT_STEP_PX = 16
    const LEADING_ICON_AREA_PX = 32

    function getDisplayId(n: AnyRecord): string {
      const { id } = getNodeLabel(n)
      try {
        let naming: string | null = null
        if (typeof (n as any).namingQuery === 'string') {
          const resolved = resolveQueryValue('namingQuery', (n as any).namingQuery)
          if (resolved && typeof resolved === 'object' && !Array.isArray(resolved) && typeof (resolved as any).name === 'string' && String((resolved as any).name).trim()) {
            naming = String((resolved as any).name).trim()
          }
        } else if ((n as any).namingQuery && typeof (n as any).namingQuery === 'object' && typeof (n as any).namingQuery.name === 'string') {
          naming = String((n as any).namingQuery.name).trim()
        }
        return naming ? `${id} (${naming})` : id
      } catch { return id }
    }

    const buildNodeDetails = (n: AnyRecord, nPath: string, nDepth: number): HTMLDetailsElement => {
      const details = document.createElement('details')
      details.setAttribute('data-path', nPath)
      const hasKids = hasChildren(n)
      const summary = document.createElement('summary')
      summary.style.listStyle = 'none'
      const indent = document.createElement('span')
      indent.className = 'indent'
      indent.textContent = '    '.repeat(nDepth)
      summary.appendChild(indent)
      const caret = document.createElement('span')
      caret.className = 'caret'
      caret.textContent = '▸'
      summary.appendChild(caret)
      const icon = document.createElement('span')
      icon.className = hasKids ? 'icon folder' : 'icon file'
      summary.appendChild(icon)
      const bullet = document.createElement('span')
      bullet.className = 'bullet'
      summary.appendChild(bullet)
      const { type } = getNodeLabel(n)
      const textContainer = document.createElement('div')
      textContainer.className = 'text-container'
      const label = document.createElement('div')
      label.className = 'label'
      label.textContent = getDisplayId(n)
      textContainer.appendChild(label)
      if (type) {
        const meta = document.createElement('div')
        meta.className = 'meta'
        meta.textContent = type
        textContainer.appendChild(meta)
      }
      summary.appendChild(textContainer)
      const total = getDescendantCount(n)
      if (total > 0) {
        const count = document.createElement('span')
        count.className = 'badge'
        count.textContent = String(total)
        count.title = `${total} total descendants`
        summary.appendChild(count)
      }
      
      // Query size calculation button
      const calcBtn = document.createElement('button')
      calcBtn.className = 'print-btn'
      calcBtn.textContent = '📊'
      calcBtn.title = 'Calculate total query size (this component + all children)'
      calcBtn.style.marginLeft = '4px'
      const resultSpan = document.createElement('span')
      resultSpan.style.fontSize = '11px'
      resultSpan.style.marginLeft = '6px'
      resultSpan.style.color = '#059669'
      resultSpan.style.fontWeight = '600'
      let lastCalcResult: QuerySizeResult | null = null
      
      calcBtn.addEventListener('click', (e) => { 
        e.stopPropagation()
        e.preventDefault()
        
        if (!fullJSON) {
          resultSpan.textContent = 'No data'
          resultSpan.style.color = '#dc2626'
          return
        }
        
        calcBtn.disabled = true
        calcBtn.textContent = '⏳'
        resultSpan.textContent = 'Calculating...'
        resultSpan.style.color = '#6b7280'
        resultSpan.style.fontStyle = 'italic'
        
        // Run calculation in next tick to allow UI to update
        setTimeout(() => {
          try {
            const result = calculateTotalQuerySize(n, fullJSON!, resolveQueryValue)
            const sizeText = formatBytes(result.totalSize)
            resultSpan.textContent = sizeText
            resultSpan.style.color = '#059669'
            resultSpan.style.fontStyle = 'normal'
            resultSpan.style.cursor = 'pointer'
            resultSpan.style.textDecoration = 'underline'
            resultSpan.title = 'Click to view breakdown'
            calcBtn.textContent = '📊'
            calcBtn.disabled = false
            lastCalcResult = result
            
            // Show breakdown in console
            console.group(`Query Size for ${getDisplayId(n)}`)
            console.log('Total:', sizeText)
            console.log('Breakdown:', result.breakdown)
            console.log('Details:', result.details)
            console.groupEnd()
          } catch (error) {
            console.error('Error calculating query size:', error)
            resultSpan.textContent = 'Error'
            resultSpan.style.color = '#dc2626'
            resultSpan.style.fontStyle = 'normal'
            calcBtn.textContent = '📊'
            calcBtn.disabled = false
          }
        }, 10)
      })
      
      // Allow clicking result to re-open breakdown
      resultSpan.addEventListener('click', (e) => {
        e.stopPropagation()
        if (lastCalcResult) {
          window.dispatchEvent(new CustomEvent(BREAKDOWN_EVENT, { detail: lastCalcResult }))
        }
      })
      summary.appendChild(calcBtn)
      summary.appendChild(resultSpan)
      
      details.appendChild(summary)

      const structureProps = Object.entries(n).filter(([k]) => k !== 'children' && k !== 'components')
      if (structureProps.length > 0) {
        const sDet = document.createElement('details')
        sDet.className = 'section-details structure-section'
        const sSum = document.createElement('summary')
        sSum.className = 'section-summary'
        const left = (nDepth - 1) * INDENT_STEP_PX + LEADING_ICON_AREA_PX
        sDet.style.marginLeft = `${left}px`
        const sIcon = document.createElement('span')
        sIcon.className = 'section-icon'
        sIcon.textContent = '⚙️'
        sSum.appendChild(sIcon)
        sSum.appendChild(document.createTextNode(` structure (${structureProps.length} properties)`))
        sDet.appendChild(sSum)
        const sCont = document.createElement('div')
        sCont.className = 'structure section-content'
        const printRow = document.createElement('div')
        printRow.style.display = 'flex'
        printRow.style.justifyContent = 'flex-end'
        printRow.style.marginBottom = '6px'
        const printBtn = document.createElement('button')
        printBtn.className = 'print-btn'
        printBtn.textContent = '🖨️'
        printBtn.title = 'Print this item to console'
        printBtn.addEventListener('click', (e) => { e.stopPropagation(); console.clear(); console.log(n) })
        printRow.appendChild(printBtn)
        sCont.appendChild(printRow)
        for (const [key, value] of structureProps) {
          const row = document.createElement('div')
          row.className = 'property-section'
          const keyEl = document.createElement('span')
          keyEl.className = 'property-key'
          keyEl.textContent = key + ':'
          row.appendChild(keyEl)
          const resolved = key.endsWith('Query') ? resolveQueryValue(key, value) : value
          if (resolved === null || resolved === undefined) { const v = document.createElement('span'); v.className = 'property-value null'; v.textContent = String(resolved); row.appendChild(v) }
          else if (resolved && typeof resolved === 'object' && (resolved as any).__unresolved) { const v = document.createElement('span'); v.className = 'property-value null unresolved'; v.textContent = `null (${(resolved as any).originalQuery})`; row.appendChild(v) }
          else if (typeof resolved === 'object' && !Array.isArray(resolved)) {
            const od = document.createElement('details')
            od.className = 'property-object'
            const os = document.createElement('summary')
            os.className = 'property-value object-summary'
            os.textContent = `{...} (${Object.keys(resolved).length} properties)`
            od.appendChild(os)
            const oc = document.createElement('div')
            oc.className = 'object-properties'
            for (const [ok, ov] of Object.entries(resolved)) {
              const op = document.createElement('div')
              op.className = 'nested-property'
              const opk = document.createElement('span')
              opk.className = 'property-key nested'
              opk.textContent = ok + ':'
              op.appendChild(opk)
              const opv = document.createElement('span')
              opv.className = 'property-value'
              opv.textContent = typeof ov === 'object' ? (Array.isArray(ov) ? `[Array(${(ov as any[]).length})]` : '{Object}') : String(ov)
              op.appendChild(opv)
              oc.appendChild(op)
            }
            od.appendChild(oc)
            row.appendChild(od)
          } else if (Array.isArray(resolved)) { const v = document.createElement('span'); v.className = 'property-value array'; v.textContent = `[Array(${resolved.length})]`; row.appendChild(v) }
          else { const v = document.createElement('span'); v.className = `property-value ${typeof resolved}`; v.textContent = String(resolved); row.appendChild(v) }
          sCont.appendChild(row)
        }
        sDet.appendChild(sCont)
        details.appendChild(sDet)
      }

      details.addEventListener('toggle', () => {
        if (!details.open) { pruneChildren(details); (details as any).dataset.hydrated = '0'; return }
        if ((details as any).dataset.hydrated === '1') return
        const kids = getChildren(n).slice().sort((a, b) => getDescendantCount(b) - getDescendantCount(a))
        for (let i = 0; i < kids.length; i++) {
          const child = kids[i]
          const childEl = buildNodeDetails(child, `${nPath}/${i}`, nDepth + 1)
          const s = details.querySelector(':scope > details.section-details.structure-section')
          if (s) details.insertBefore(childEl, s); else details.appendChild(childEl)
        }
        ;(details as any).dataset.hydrated = '1'
      })

      return details
    }

    const children = getChildren(node).slice().sort((a, b) => getDescendantCount(b) - getDescendantCount(a))
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childDetails = buildNodeDetails(child, `${path}/${i}`, depth + 1)
      const rootStructure = parent.querySelector(':scope > details.section-details.structure-section')
      if (rootStructure) parent.insertBefore(childDetails, rootStructure)
      else parent.appendChild(childDetails)
    }
    hydratedRef.current = true
  }, [node, path, depth, parentRef, pruneChildren, resolveQueryValue, fullJSON])

  useEffect(() => {
    const parent = parentRef.current
    if (!parent) return
    const onToggle = () => {
      if (parent.open) hydrate()
      else { pruneChildren(parent); hydratedRef.current = false }
    }
    parent.addEventListener('toggle', onToggle)
    if (parent.open) hydrate()
    return () => { parent.removeEventListener('toggle', onToggle) }
  }, [parentRef, hydrate, pruneChildren])

  return null
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  const value = i === 0 ? Math.round(n) : Math.round(n * 10) / 10
  return `${value}${units[i]}`
}

function estimateSize(value: any): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

type QueryItemDetail = {
  id: string
  queryType: string
  size: number
  componentId: string
  componentPath: string
  nestedRefs?: QueryItemDetail[]
}

type QuerySizeResult = {
  totalSize: number
  breakdown: Record<string, number>
  details: QueryItemDetail[]
}

// Helper to check if a string looks like a data reference
function looksLikeDataRef(str: string): boolean {
  if (typeof str !== 'string') return false
  // Check for #-prefixed refs
  if (str.startsWith('#')) return true
  // Common ID patterns found in Wix data maps
  // Includes: dataItem-*, comp-*, style-*, layout-*, variants-*, transformations-*, etc.
  return /^[a-zA-Z]+-[a-zA-Z0-9]+$/.test(str)
}

// Helper to try resolving a reference from all data maps
// Returns { data, queryType } where queryType is the corresponding query name
function tryResolveFromDataMaps(refId: string, fullJSON: AnyRecord): { data: any, queryType: string | null } | null {
  if (!fullJSON) return null
  
  // Create reverse mapping: data map key -> query type
  const dataMapToQueryType: Record<string, string> = {}
  for (const [queryType, mapKey] of Object.entries(DATA_MAP_MAPPINGS)) {
    dataMapToQueryType[mapKey] = queryType
  }
  
  // Get the data container
  const dataContainer = (fullJSON as any).data
  if (!dataContainer || typeof dataContainer !== 'object') return null
  
  // Search through ALL data maps in the data container (not just the ones in DATA_MAP_MAPPINGS)
  for (const mapKey of Object.keys(dataContainer)) {
    const dataMap = dataContainer[mapKey]
    if (dataMap && typeof dataMap === 'object' && !Array.isArray(dataMap) && refId in dataMap) {
      return { data: dataMap[refId], queryType: dataMapToQueryType[mapKey] || mapKey }
    }
  }
  
  // Also check the root level (for legacy structures)
  for (const mapKey of Object.values(DATA_MAP_MAPPINGS)) {
    const dataMap = fullJSON[mapKey]
    if (dataMap && typeof dataMap === 'object' && !Array.isArray(dataMap) && refId in dataMap) {
      return { data: dataMap[refId], queryType: dataMapToQueryType[mapKey] || null }
    }
  }
  
  return null
}

// Recursively find nested data references and calculate their size
function findNestedRefsAndCalculateSize(
  obj: any,
  fullJSON: AnyRecord,
  visited: Set<string>,
  breakdown: Record<string, number>,
  nestedDetails: QueryItemDetail[],
  componentId: string,
  componentPath: string
): number {
  if (!obj || typeof obj !== 'object') return 0
  
  let size = 0
  
  const processValue = (value: any) => {
    if (typeof value === 'string' && looksLikeDataRef(value)) {
      const refId = value.startsWith('#') ? value.slice(1) : value
      if (!visited.has(refId)) {
        visited.add(refId)
        const resolveResult = tryResolveFromDataMaps(refId, fullJSON)
        if (resolveResult) {
          const { data: resolved, queryType } = resolveResult
          const resolvedSize = estimateSize(resolved)
          size += resolvedSize
          
          // Add to the appropriate query type in breakdown (or 'other' if unknown)
          const breakdownKey = queryType || 'other'
          breakdown[breakdownKey] = (breakdown[breakdownKey] || 0) + resolvedSize
          
          // Track nested ref detail with actual query type
          const nestedRefDetails: QueryItemDetail[] = []
          nestedDetails.push({
            id: refId,
            queryType: queryType || 'other',
            size: resolvedSize,
            componentId,
            componentPath,
            nestedRefs: nestedRefDetails
          })
          
          // Recurse into the resolved object
          size += findNestedRefsAndCalculateSize(resolved, fullJSON, visited, breakdown, nestedRefDetails, componentId, componentPath)
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recurse into nested objects/arrays
      size += findNestedRefsAndCalculateSize(value, fullJSON, visited, breakdown, nestedDetails, componentId, componentPath)
    }
  }
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      processValue(item)
    }
  } else {
    for (const value of Object.values(obj)) {
      processValue(value)
    }
  }
  
  return size
}

// Calculate total query size for a component and all its descendants
function calculateTotalQuerySize(
  node: AnyRecord,
  fullJSON: AnyRecord,
  resolveQueryValue: (k: string, v: any) => any,
  path: string = ''
): QuerySizeResult {
  const breakdown: Record<string, number> = {}
  const visited = new Set<string>()
  const details: QueryItemDetail[] = []
  let totalSize = 0
  
  const nodeId = node.id || node.name || '(no-id)'
  const currentPath = path ? `${path} > ${nodeId}` : nodeId
  
  // Process this node's queries
  for (const [key, value] of Object.entries(node)) {
    if (key.endsWith('Query') && typeof value === 'string') {
      const resolved = resolveQueryValue(key, value)
      if (resolved && typeof resolved === 'object' && !(resolved as any).__unresolved) {
        const directSize = estimateSize(resolved)
        totalSize += directSize
        breakdown[key] = (breakdown[key] || 0) + directSize
        
        // Mark as visited to avoid recounting in nested refs
        const queryId = value.startsWith('#') ? value.slice(1) : value
        visited.add(queryId)
        
        // Track this query's details
        const nestedRefDetails: QueryItemDetail[] = []
        details.push({
          id: queryId,
          queryType: key,
          size: directSize,
          componentId: nodeId,
          componentPath: currentPath,
          nestedRefs: nestedRefDetails
        })
        
        // Find nested refs within this resolved data
        const nestedSize = findNestedRefsAndCalculateSize(resolved, fullJSON, visited, breakdown, nestedRefDetails, nodeId, currentPath)
        totalSize += nestedSize
      }
    }
  }
  
  // Process styleId - references theme_data
  if (typeof node.styleId === 'string' && node.styleId) {
    const styleId = node.styleId
    if (!visited.has(styleId)) {
      visited.add(styleId)
      const resolveResult = tryResolveFromDataMaps(styleId, fullJSON)
      if (resolveResult) {
        const { data: resolved, queryType } = resolveResult
        const directSize = estimateSize(resolved)
        totalSize += directSize
        const breakdownKey = 'styleId'
        breakdown[breakdownKey] = (breakdown[breakdownKey] || 0) + directSize
        
        // Track this style's details
        const nestedRefDetails: QueryItemDetail[] = []
        details.push({
          id: styleId,
          queryType: 'styleId',
          size: directSize,
          componentId: nodeId,
          componentPath: currentPath,
          nestedRefs: nestedRefDetails
        })
        
        // Find nested refs within this resolved data
        const nestedSize = findNestedRefsAndCalculateSize(resolved, fullJSON, visited, breakdown, nestedRefDetails, nodeId, currentPath)
        totalSize += nestedSize
      }
    }
  }
  
  // Process skin - might also reference theme_data
  if (typeof node.skin === 'string' && node.skin) {
    const skinId = node.skin
    if (!visited.has(skinId)) {
      visited.add(skinId)
      const resolveResult = tryResolveFromDataMaps(skinId, fullJSON)
      if (resolveResult) {
        const { data: resolved } = resolveResult
        const directSize = estimateSize(resolved)
        totalSize += directSize
        breakdown['skin'] = (breakdown['skin'] || 0) + directSize
        
        details.push({
          id: skinId,
          queryType: 'skin',
          size: directSize,
          componentId: nodeId,
          componentPath: currentPath,
          nestedRefs: []
        })
      }
    }
  }
  
  // Recursively process children
  const children = getChildren(node)
  for (const child of children) {
    const childResult = calculateTotalQuerySize(child, fullJSON, resolveQueryValue, currentPath)
    totalSize += childResult.totalSize
    
    // Merge breakdown
    for (const [key, size] of Object.entries(childResult.breakdown)) {
      breakdown[key] = (breakdown[key] || 0) + size
    }
    
    // Merge details
    details.push(...childResult.details)
  }
  
  return { totalSize, breakdown, details }
}

