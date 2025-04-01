/**
 * Image CDN Worker
 * Handles image optimization and delivery
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // CORS headers for cross-origin requests
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // Handle OPTIONS request for CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    })
  }

  try {
    const url = new URL(request.url)
    
    // If path starts with image request
    if (url.pathname.startsWith('/images/')) {
      // Extract the path to forward to origin
      const imagePath = url.pathname
      
      // Forward to origin (your actual storage/server)

      // Update this URL to your actual Supabase URL where images are stored
      const originUrl = `https://nzceuozudxipzmpwavmw.supabase.co/storage/v1/object/public${imagePath}`
      
      // Fetch the image from origin
      let response = await fetch(originUrl, {
        headers: request.headers,
        method: request.method
      })
      
      // If the image exists, return it with proper headers
      if (response.ok) {
        let newHeaders = new Headers(response.headers)
        
        // Add CORS headers
        Object.keys(corsHeaders).forEach(key => {
          newHeaders.set(key, corsHeaders[key])
        })
        
        // Add caching headers for better performance
        newHeaders.set('Cache-Control', 'public, max-age=31536000')
        
        // Return the response with the updated headers
        return new Response(response.body, {
          status: response.status,
          headers: newHeaders
        })
      }
    }
    
    // If no conditions match, return 404
    return new Response('Not found', {
      status: 404,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain'
      }
    })
  } catch (err) {
    // Return error response
    return new Response(`Error: ${err.message}`, {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain'
      }
    })
  }
}
