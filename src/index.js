import { createClient } from '@supabase/supabase-js';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

async function handleRequest(request, event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  // ✅ Health check
  if (pathname === '/' || pathname === '/health' || pathname === '/_health') {
    return new Response(JSON.stringify({
      status: 'ok',
      message: 'Image CDN Worker is running.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  // ✅ Handle key-based image requests
  if (pathname.startsWith('/website-images/')) {
    const key = pathname.replace('/website-images/', '').replace(/\/$/, '');

    if (!key) {
      return createDynamicPlaceholder('Invalid key', corsHeaders, 400, 'Missing image key');
    }

    try {
      // Create Supabase client
      const supabase = createClient(
        SUPABASE_URL, // <- Supplied via environment
        SUPABASE_KEY  // <- Supplied via secret
      );

      // Look up the storage path from the key
      const { data, error } = await supabase
        .from('website-images')
        .select('storage_path')
        .eq('key', key)
        .single();

      if (error || !data?.storage_path) {
        return createDynamicPlaceholder(key, corsHeaders, 404, 'Image key not found');
      }

      const originUrl = `https://eukenximajiuhrtljnpw.supabase.co/storage/v1/object/public/website-images/${data.storage_path}`;
      const response = await fetchWithRetry(originUrl, request);

      if (response?.ok) {
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        headers.set('Cache-Control', 'public, max-age=31536000');
        headers.set('CDN-Cache', 'HIT');
        return new Response(response.body, { status: 200, headers });
      } else {
        return createDynamicPlaceholder(key, corsHeaders, response?.status || 500, 'Image fetch failed');
      }
    } catch (err) {
      return createDynamicPlaceholder(key, corsHeaders, 500, err.message);
    }
  }

  // ❌ Unknown route
  return new Response(JSON.stringify({
    error: 'Not Found',
    path: pathname,
    message: 'Unsupported route.'
  }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchWithRetry(url, request, maxAttempts = 2) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      const response = await fetch(url, {
        cf: {
          cacheEverything: true,
          cacheTtl: 31536000,
          image: { fit: 'scale-down', quality: 85 },
        },
        headers: request.headers,
        method: request.method,
      });

      if (response.ok || response.status === 404) return response;
    } catch (_) {}

    await new Promise(r => setTimeout(r, Math.pow(2, attempts) * 300));
    attempts++;
  }

  return null;
}

function createDynamicPlaceholder(path, corsHeaders, status = 404, message = '') {
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="600" fill="#0A1A2F"/>
    <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="32" text-anchor="middle" fill="#fff">Image Not Found</text>
    <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="#E07A5F">${path}</text>
    ${message ? `<text x="50%" y="65%" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#D4AF37">${message}</text>` : ''}
  </svg>`;

  return new Response(svg, {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
      'CDN-Cache': 'MISS',
    },
  });
}
