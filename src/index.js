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
    
    // Debug logging
    console.log(`Processing request for: ${url.pathname}${url.search}`)
    
    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/_health') {
      // Test connection to Supabase
      let supabaseStatus = 'unknown';
      try {
        const testUrl = 'https://eukenximajiuhrtljnpw.supabase.co/storage/v1/object/public/images/test.jpg';
        const testResponse = await fetch(testUrl, { 
          method: 'HEAD',
          cf: { cacheTtl: 0, cacheEverything: false }
        });
        supabaseStatus = testResponse.ok ? 'healthy' : 'degraded';
      } catch (error) {
        supabaseStatus = 'unhealthy';
        console.error('Supabase connection test failed:', error);
      }

      return new Response(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        supabase: supabaseStatus
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      });
    }
    
    // Handle placeholder.svg specially - with fixed dimensions
    if (url.pathname.includes('placeholder.svg')) {
      // Create a simple SVG placeholder with navy background (brand color)
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
    
    // Log all incoming requests for debugging
    console.log(`CDN request received for: ${url.pathname}${url.search}`);
    
    // If path starts with any recognizable image path
    if (url.pathname.startsWith('/images/') || 
        url.pathname.startsWith('/website-images/') ||
        url.pathname.match(/\/\d+\-ChatGPT\-Image/) ||  // Handle timestamps with ChatGPT image paths
        url.pathname.includes('/storage/v1/object/public') ||
        url.pathname.startsWith('/lovable-uploads/')) {
      
      // Extract the path to forward to origin
      const imagePath = url.pathname
      
      // Forward to origin (your actual storage/server)
      let originUrl;
      
      // If the URL already contains the Supabase domain, extract just the path
      if (url.pathname.includes('/storage/v1/object/public')) {
        // It's already a Supabase URL - keep it as is
        const fullPath = url.pathname + url.search;  // Include query parameters
        originUrl = `https://eukenximajiuhrtljnpw.supabase.co${fullPath}`;
        console.log(`Using direct Supabase URL: ${originUrl}`);
      } else {
        // Regular images path - construct the Supabase URL
        originUrl = `https://eukenximajiuhrtljnpw.supabase.co/storage/v1/object/public${imagePath}${url.search}`;
        console.log(`Constructed Supabase URL: ${originUrl}`);
      }
      
      console.log(`Forwarding request to: ${originUrl}`)
      
      // Fetch the image from origin with retry logic
      let response;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          response = await fetch(originUrl, {
            cf: {
              // Enable Cloudflare's image optimization if available
              image: {
                quality: 85,
                fit: "scale-down",
              },
              cacheTtl: 31536000, // Cache for 1 year
              cacheEverything: true,
            },
            headers: request.headers,
            method: request.method
          });
          
          // If successful, break out of retry loop
          if (response.ok) break;
          
          // If not found, no need to retry
          if (response.status === 404) break;
          
        } catch (fetchError) {
          console.error(`Attempt ${attempts + 1} failed: ${fetchError.message}`);
        }
        
        // Exponential backoff before retry
        attempts++;
        if (attempts < maxAttempts) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempts), 5000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
      
      // If the image exists, return it with proper headers
      if (response && response.ok) {
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
        const errorStatus = response ? response.status : 'No response';
        console.error(`Origin image not found: ${originUrl} (status: ${errorStatus})`);
        const placeholderSvg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
          <rect width="800" height="600" fill="#0A1A2F"/>
          <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="32" text-anchor="middle" fill="#fff">Image Not Found</text>
          <text x="50%" y="58%" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="#E07A5F">Path: ${imagePath}</text>
        </svg>`;
        
        return new Response(placeholderSvg, {
          status: 200, // Return 200 OK instead of 404 to prevent client errors
          headers: {
            ...corsHeaders,
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
    }
    
    // Special handler for the root path - return a status message
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('Image CDN is running. Use /images/path/to/image.jpg to access images.', {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain'
        }
      });
    }
    
    // If no conditions match, return 404
    console.log(`No handler for path: ${url.pathname}`);
    return new Response(`Not found: ${url.pathname}`, {
      status: 404,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain'
      }
    })
  } catch (err) {
      // Return structured error response
    console.error(`Worker error: ${err.message}`);
      // Generate a request ID to help with debugging
    const requestId = crypto.randomUUID();
    
    return new Response(JSON.stringify({
      error: 'An error occurred processing your request',
      requestId: requestId,
      // Don't expose full error details in production
      ...(process.env.NODE_ENV !== 'production' ? { 
        message: err.message,
        stack: err.stack 
      } : {})
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    })
  }
}

