import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  'variantsQuery': 'variants_data'
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

  const params = useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), [])

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
    const url = params.get('url')
    if (url) {
      const normalized = ensureCompressedPageUrl(url)
      if (normalized !== url && typeof window !== 'undefined') {
        const loc = new URL(window.location.href)
        loc.searchParams.set('url', normalized)
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
              <TreeRoot data={root} resolveQueryValue={resolveQueryValue} />
            ) : (
              <div className="text-[color:var(--muted)]">No JSON loaded. Pass ?url=…</div>
            )
          ) : (
            fullJSON?.data ? (
              <DataView data={fullJSON.data} />
            ) : (
              <div className="text-[color:var(--muted)]">No data found in JSON</div>
            )
          )}
        </main>
      </div>
    </div>
  )
}

function DataView({ data }: { data: AnyRecord }) {
  const [sortBy, setSortBy] = useState<'count' | 'size'>('count')

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

  return (
    <div>
      <div className="mb-3 pb-2 border-b border-[color:var(--border)] flex items-center justify-between">
        <span className="text-sm text-[color:var(--muted)] italic">
          Total estimated size: <span className="font-semibold text-[color:var(--text)]">{formatBytes(totalSize)}</span>
        </span>
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
      {dataEntries.map(({ key, count, type, value, size }) => (
        <DataEntry key={key} entryKey={key} count={count} type={type} value={value} data={data} size={size} />
      ))}
    </div>
  )
}

function DataEntry({ entryKey, count, type, value, data, size }: { 
  entryKey: string, 
  count: number, 
  type: string, 
  value: any,
  data: AnyRecord,
  size: number
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showCount, setShowCount] = useState(10)
  const [expandedNestedKey, setExpandedNestedKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const nestedEntries = useMemo(() => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return Object.entries(value)
  }, [value])

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return nestedEntries
    const query = searchQuery.toLowerCase()
    return nestedEntries.filter(([key]) => key.toLowerCase().includes(query))
  }, [nestedEntries, searchQuery])

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
              return (
                <details 
                  key={nestedKey}
                  className="group/nested"
                  open={isNestedExpanded}
                  onToggle={(e) => setExpandedNestedKey(e.currentTarget.open ? nestedKey : null)}
                >
                  <summary className="list-none cursor-pointer hover:bg-blue-50/50 transition-colors py-1.5 px-2 rounded">
                    <div className="flex items-center gap-2">
                      <span className="caret text-sm">{isNestedExpanded ? '▸' : '▸'}</span>
                      <span className="icon file"></span>
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm text-[color:var(--text)] truncate">{nestedKey}</div>
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

function TreeRoot({ data, resolveQueryValue }: { data: AnyRecord, resolveQueryValue: (k: string, v: any) => any }) {
  const rootRef = useRef<HTMLDetailsElement>(null)
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
      </summary>
      {/* Children are injected directly under the root details (no extra wrapper) */}
      <ChildrenHydrator parentRef={rootRef} node={data} path="root" depth={0} resolveQueryValue={resolveQueryValue} />
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
function ChildrenHydrator({ parentRef, node, path, depth, resolveQueryValue }: { parentRef: RefObject<HTMLDetailsElement> | MutableRefObject<HTMLDetailsElement | null>, node: AnyRecord, path: string, depth: number, resolveQueryValue: (k: string, v: any) => any }) {
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
  }, [node, path, depth, parentRef, pruneChildren, resolveQueryValue])

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

