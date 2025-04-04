addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
});

async function handleRequest(request) {
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

  // ✅ Handle /, /_health, and /health routes
  if (url.pathname === '/' || url.pathname === '/_health' || url.pathname === '/health') {
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

  // ✅ Serve images from Supabase through Worker CDN
  if (url.pathname.startsWith('/website-images/')) {
    return await handleImageRequest(url, request, corsHeaders);
  }

  // Fallback 404
  return new Response(JSON.stringify({
    error: 'Not Found',
    path: url.pathname,
    message: 'The requested path is not supported by this worker.',
  }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleImageRequest(url, request, corsHeaders) {
  const imagePath = url.pathname.replace('/website-images', '');
  const originUrl = `https://eukenximajiuhrtljnpw.supabase.co/storage/v1/object/public/website-images${imagePath}${url.search}`;

  try {
    const response = await fetchWithRetry(originUrl, request);

    if (response && response.ok) {
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      newHeaders.set('Cache-Control', 'public, max-age=31536000');
      newHeaders.set('CDN-Cache', 'HIT');
      newHeaders.set('CDN-Provider', 'Cloudflare-Worker');

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } else {
      return createDynamicPlaceholder(imagePath, corsHeaders, response?.status);
    }
  } catch (error) {
    return createDynamicPlaceholder(imagePath, corsHeaders, 500, error.message);
  }
}

async function fetchWithRetry(url, request, maxAttempts = 2) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      const response = await fetch(url, {
        cf: {
          image: { quality: 85, fit: 'scale-down' },
          cacheTtl: 31536000,
          cacheEverything: true,
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
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
      'CDN-Cache': 'MISS',
    },
  });
}
