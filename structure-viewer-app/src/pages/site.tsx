import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type PageItem = {
  pageId: string
  title?: string
  pageUriSEO?: string
  pageJsonFileName?: string
}

export default function Site() {
  const [siteUrl, setSiteUrl] = useState('')
  const [status, setStatus] = useState('')
  const [pages, setPages] = useState<PageItem[]>([])
  const [masterFileName, setMasterFileName] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const query = useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), [])

  const fetchPages = useCallback(async (url: string) => {
    const src = String(url || '').trim()
    if (!src) { setStatus('Enter a valid site URL'); return }
    try {
      setStatus('Fetching site models…')
      setPages([])
      const res = await fetch(`/api/site-models?site=${encodeURIComponent(src)}`)
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const siteModels = await res.json()
      const p: PageItem[] = siteModels?.rendererModel?.pageList?.pages || []
      const master: string | undefined = siteModels?.rendererModel?.pageList?.masterPageJsonFileName
      setPages(p)
      setMasterFileName(master && typeof master === 'string' && master.trim() ? master : null)
      setStatus(`Loaded ${p.length} pages`)
      const urlObj = new URL(window.location.href)
      urlObj.searchParams.set('site', src)
      window.history.replaceState({}, '', urlObj)

      // Update localStorage history
      try {
        const raw = window.localStorage.getItem('siteHistory')
        let existing: unknown = raw ? JSON.parse(raw) : []
        if (!Array.isArray(existing)) existing = []
        const updated = [src, ...((existing as unknown[]).filter((u: any) => typeof u === 'string' && u !== src))] as string[]
        const trimmed = updated.slice(0, 10)
        window.localStorage.setItem('siteHistory', JSON.stringify(trimmed))
        setHistory(trimmed)
      } catch {}
    } catch (e: any) {
      setStatus(e?.message || 'Failed to load site models')
    }
  }, [])

  useEffect(() => {
    const initialSite = query.get('site')
    if (initialSite) {
      setSiteUrl(initialSite)
      fetchPages(initialSite)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load site history on mount
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('siteHistory') : null
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const unique = Array.from(new Set(parsed.filter((v: any) => typeof v === 'string' && String(v).trim()))) as string[]
          setHistory(unique)
        }
      }
    } catch {}
  }, [])

  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return pages
    return pages.filter((p) => (p.title || '').toLowerCase().includes(q))
  }, [pages, search])

  return (
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Site Loader</h1>
          <p className="text-sm text-[color:var(--muted)]">Enter a site URL to fetch its pages</p>
          <div className="mt-2 text-sm">
            <Link href="/" className="text-blue-600 hover:underline">Go to viewer</Link>
          </div>
        </header>

        <section className="rounded-xl border border-[color:var(--border)] bg-white/70 backdrop-blur p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchPages(siteUrl) }}
              placeholder="https://example.com"
              type="url"
              aria-label="Site URL"
              className="w-full min-w-0 rounded-lg border border-[color:var(--border)] bg-white px-3 py-2 text-[color:var(--text)] shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => fetchPages(siteUrl)}
              type="button"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-white shadow-sm transition hover:bg-blue-500"
            >
              Load site pages
            </button>
            <span className="text-sm text-[color:var(--muted)]" aria-live="polite">{status}</span>
          </div>
        </section>

        {/* Search visible only when pages are loaded */}
        {pages.length > 0 ? (
          <section className="mt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pages by title"
                type="text"
                aria-label="Search pages"
                className="w-full min-w-0 rounded-lg border border-[color:var(--border)] bg-white px-3 py-2 text-[color:var(--text)] shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-[color:var(--muted)]">{filteredPages.length} / {pages.length} shown</span>
            </div>
          </section>
        ) : null}

        {history.length > 0 ? (
          <section className="mt-4 rounded-xl border border-[color:var(--border)] bg-white/70 backdrop-blur p-3 shadow-sm">
            <div className="mb-2 text-sm font-medium text-[color:var(--text)]">History</div>
            <div className="flex flex-wrap gap-2">
              {history.map((u) => (
                <button
                  key={u}
                  onClick={() => { setSiteUrl(u); fetchPages(u) }}
                  type="button"
                  className="max-w-full truncate rounded-md border border-[color:var(--border)] bg-white px-2 py-1 text-sm text-blue-700 shadow-sm hover:bg-blue-50"
                  title={u}
                >
                  {u}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <main className="mt-6">
          {filteredPages.length === 0 && !masterFileName ? (
            <div className="text-[color:var(--muted)]">No pages loaded.</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-white/80 shadow-sm">
              <ul className="divide-y divide-[color:var(--border)]">
                {masterFileName ? (() => {
                  const jsonUrl = `https://pages.parastorage.com/sites/${masterFileName}`
                  const href = `/viewer?url=${encodeURIComponent(jsonUrl)}`
                  return (
                    <li key="__master">
                      <Link href={href} className="group flex items-center justify-between px-4 py-3 hover:bg-blue-50">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[color:var(--text)]">Master Page</div>
                          <div className="truncate text-xs text-[color:var(--muted)]">master</div>
                        </div>
                        <span className="text-blue-600 opacity-0 transition group-hover:opacity-100">→</span>
                      </Link>
                    </li>
                  )
                })() : null}

                {filteredPages.map((p) => {
                  const fileName = p.pageJsonFileName || ''
                  const jsonUrl = fileName ? `https://pages.parastorage.com/sites/${fileName}` : ''
                  const href = jsonUrl ? `/viewer?url=${encodeURIComponent(jsonUrl)}` : '#'
                  return (
                    <li key={p.pageId}>
                      <Link href={href} className="group flex items-center justify-between px-4 py-3 hover:bg-blue-50">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[color:var(--text)]">{p.title || '(untitled)'}</div>
                          <div className="truncate text-xs text-[color:var(--muted)]">{p.pageId}</div>
                        </div>
                        <span className="text-blue-600 opacity-0 transition group-hover:opacity-100">→</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}


