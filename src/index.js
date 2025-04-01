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
    
    // Handle placeholder.svg specially
    if (url.pathname.includes('placeholder.svg')) {
      // Create a simple SVG placeholder
      const placeholderSvg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <rect width="800" height="600" fill="#0A1A2F"/>
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="32" text-anchor="middle" fill="#fff">Image Placeholder</text>
      </svg>`;
      
      return new Response(placeholderSvg, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400'
        }
      });
    }
    
    // If path starts with any recognizable image path
    if (url.pathname.startsWith('/images/') || url.pathname.startsWith('/website-images/')) {
      // Extract the path to forward to origin
      const imagePath = url.pathname
      
      // Forward to origin (your actual storage/server)
      let originUrl;
      
      // Handle direct references to website-images bucket
      if (url.pathname.startsWith('/website-images/')) {
        originUrl = `https://nzceuozudxipzmpwavmw.supabase.co/storage/v1/object/public${imagePath}`
      } else {
        // Regular images path
        originUrl = `https://nzceuozudxipzmpwavmw.supabase.co/storage/v1/object/public${imagePath}`
      }
      
      console.log(`Forwarding request to: ${originUrl}`)
      
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
      } else {
        // If image doesn't exist in origin, return the placeholder SVG
        console.error(`Origin image not found: ${originUrl}`);
        const placeholderSvg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
          <rect width="800" height="600" fill="#0A1A2F"/>
          <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="32" text-anchor="middle" fill="#fff">Image Not Found</text>
        </svg>`;
        
        return new Response(placeholderSvg, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=3600'
          }
        });
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
