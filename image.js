// Image handler for CDN
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }

  // Handle OPTIONS requests for CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    })
  }
  
  // Only handle GET requests
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { 
      status: 405,
      headers: corsHeaders
    })
  }
  
  // Parse the URL and pathname
  const url = new URL(request.url)
  const path = url.pathname
  
  try {
    // Create a new request with the origin's URL
    const originUrl = `https://eukenximajiuhrtljnpw.supabase.co${path}${url.search}`
    
    const originRequest = new Request(originUrl, {
      headers: request.headers,
      method: request.method
    })
    
    // Fetch from origin
    const response = await fetch(originRequest)
    
    // If response was successful, create a modified response with CORS headers
    if (response.ok) {
      const headers = new Headers(response.headers)
      
      // Add CORS headers
      Object.keys(corsHeaders).forEach(key => {
        headers.set(key, corsHeaders[key])
      })
      
      // Add caching headers
      headers.set('Cache-Control', 'public, max-age=604800') // Cache for 1 week
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      })
    }
    
    // If origin response wasn't successful, return it with CORS headers
    const errorHeaders = new Headers(response.headers)
    Object.keys(corsHeaders).forEach(key => {
      errorHeaders.set(key, corsHeaders[key])
    })
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: errorHeaders
    })
  } catch (err) {
    // Return a 500 error if something went wrong
    return new Response(`Server error: ${err.message}`, {
      status: 500,
      headers: corsHeaders
    })
  }
}
