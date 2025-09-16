import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }
  const urlParam = (req.query.url as string) || ''
  if (!urlParam) return res.status(400).json({ error: 'Missing url param' })
  try {
    // Some CDNs (including pages.parastorage.com) block non-browser user agents.
    // Send browser-like headers and forward basic hints from the client to avoid 403s.
    const target = new URL(urlParam)
    const targetOrigin = target.origin
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8',
      'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': (req.headers['accept-language'] as string) || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Origin': targetOrigin,
      'Referer': `${targetOrigin}/`,
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Connection': 'keep-alive',
    }

    // Log outgoing request for debugging
    console.log('[page-json] outgoing request', { url: urlParam, headers })

    const upstream = await fetch(urlParam, { headers })
    if (!upstream.ok) {
      let bodySnippet = ''
      try {
        const text = await upstream.text()
        bodySnippet = text.slice(0, 500)
      } catch {}
      const upstreamHeaders = Object.fromEntries(Array.from(upstream.headers.entries()))
      console.warn('[page-json] upstream non-OK', { status: upstream.status, statusText: upstream.statusText, headers: upstreamHeaders, bodySnippet })
      return res.status(upstream.status).json({ error: `Upstream error ${upstream.status}` })
    }
    // Stream through to client preserving JSON
    const data = await upstream.json()
    return res.status(200).json(data)
  } catch (e: any) {
    console.error('[page-json] proxy error', { url: urlParam, error: e?.message, stack: e?.stack })
    return res.status(500).json({ error: e?.message || 'Proxy error' })
  }
}


