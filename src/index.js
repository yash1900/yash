/**
 * Image CDN Worker
 * Handles image optimization and delivery with improved error handling
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
    
    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/_health') {
      return createHealthCheckResponse(corsHeaders);
    }
    
    // Handle placeholder.svg specially - with fixed dimensions
    if (url.pathname.includes('placeholder.svg') || url.pathname.endsWith('/placeholder.svg')) {
      return createPlaceholderSvg(corsHeaders);
    }
    
    // If path indicates an image request
    if (isImageRequest(url.pathname)) {
      return await handleImageRequest(url, request, corsHeaders);
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
    return new Response(JSON.stringify({
      error: 'Not found',
      path: url.pathname,
      message: `The requested path "${url.pathname}" is not supported by this CDN.`
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    return handleWorkerError(err, corsHeaders);
  }
}

// Helper functions to make the main handler more readable
function createHealthCheckResponse(corsHeaders) {
  return new Response(JSON.stringify({
    status: 'ok',
    version: '1.2.0',
    timestamp: new Date().toISOString()
  }), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function createPlaceholderSvg(corsHeaders) {
  // Create a simple SVG placeholder with brand colors
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

function isImageRequest(pathname) {
  return pathname.startsWith('/images/') || 
    pathname.startsWith('/website-images/') ||
    pathname.match(/\/\d+\-ChatGPT\-Image/) ||  // Handle timestamps with ChatGPT image paths
    pathname.includes('/storage/v1/object/public') ||
    pathname.startsWith('/lovable-uploads/');
}

async function handleImageRequest(url, request, corsHeaders) {
  try {
    // Extract the path to forward to origin
    const imagePath = url.pathname;
    
    // Determine the origin URL to fetch
    let originUrl = constructOriginUrl(url);
    
    console.log(`Forwarding request to: ${originUrl}`);
    
    // Fetch the image with retry logic
    const response = await fetchWithRetry(originUrl, request);
    
    // If the image exists, return it with proper headers
    if (response && response.ok) {
      let newHeaders = new Headers(response.headers);
      
      // Add CORS headers
      Object.keys(corsHeaders).forEach(key => {
        newHeaders.set(key, corsHeaders[key]);
      });
      
      // Add caching headers for better performance
      newHeaders.set('Cache-Control', 'public, max-age=31536000');
      newHeaders.set('CDN-Cache', 'HIT');
      newHeaders.set('CDN-Provider', 'Cloudflare-Worker');
      
      // Return the response with the updated headers
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    } else {
      // Get error status or default to 404
      const errorStatus = response ? response.status : 404;
      const errorMessage = response ? `Origin returned ${response.status}` : 'Image not found';
      
      // If image doesn't exist, return proper error response with placeholder
      if (url.searchParams.get('format') === 'json') {
        // Return JSON error if requested
        return new Response(JSON.stringify({
          error: 'Image not found',
          path: imagePath,
          status: errorStatus,
          message: errorMessage
        }), {
          status: errorStatus,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          }
        });
      } else {
        // Return placeholder SVG
        return createErrorPlaceholderSvg(imagePath, corsHeaders);
      }
    }
  } catch (error) {
    console.error(`Error handling image request for ${url.pathname}:`, error);
    
    // Return JSON error if requested
    if (url.searchParams.get('format') === 'json') {
      return new Response(JSON.stringify({
        error: 'Error processing image',
        path: url.pathname,
        message: error.message || 'Unknown error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      });
    }
    
    // Otherwise return error placeholder
    return createErrorPlaceholderSvg(url.pathname, corsHeaders, error.message);
  }
}

function constructOriginUrl(url) {
  // If the URL already contains the Supabase domain, extract just the path
  if (url.pathname.includes('/storage/v1/object/public')) {
    // It's already a Supabase URL - keep it as is
    const fullPath = url.pathname + url.search;  // Include query parameters
    return `https://eukenximajiuhrtljnpw.supabase.co${fullPath}`;
  } 
  // Special case for placeholder.svg
  else if (url.pathname.includes('placeholder.svg')) {
    return url.href;
  }
  else {
    // Regular images path - construct the Supabase URL
    return `https://eukenximajiuhrtljnpw.supabase.co/storage/v1/object/public${url.pathname}${url.search}`;
  }
}

async function fetchWithRetry(url, request, maxAttempts = 2) {
  let attempts = 0;
  let response = null;
  
  // Special case for placeholder.svg - don't try to fetch from Supabase
  if (url.includes('placeholder.svg')) {
    return null; // Return null to trigger our placeholder generator
  }
  
  while (attempts < maxAttempts) {
    try {
      response = await fetch(url, {
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
      
      console.log(`Attempt ${attempts + 1} failed with status ${response.status}`);
      
    } catch (fetchError) {
      console.error(`Attempt ${attempts + 1} failed: ${fetchError.message}`);
    }
    
    // Exponential backoff before retry
    attempts++;
    if (attempts < maxAttempts) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempts), 3000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  return response;
}

function createErrorPlaceholderSvg(path, corsHeaders, errorMessage) {
  const errorText = errorMessage ? `Error: ${errorMessage}` : 'Image Not Found';
  
  const errorSvg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="600" fill="#0A1A2F"/>
    <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="32" text-anchor="middle" fill="#fff">Image Not Found</text>
    <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="#E07A5F">Path: ${path}</text>
    ${errorMessage ? `<text x="50%" y="65%" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#D4AF37">${errorText}</text>` : ''}
  </svg>`;
  
  return new Response(errorSvg, {
    status: 200, // Return 200 OK instead of 404 to prevent client errors
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'CDN-Cache': 'MISS',
      'CDN-Error': errorMessage || 'Image not found'
    }
  });
}

function handleWorkerError(err, corsHeaders) {
  // Return structured error response
  console.error(`Worker error: ${err.message}`);
  
  // Generate a request ID to help with debugging
  const requestId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
  
  return new Response(JSON.stringify({
    error: 'An error occurred processing your request',
    message: err.message || 'Unknown error',
    requestId: requestId,
    timestamp: new Date().toISOString()
  }), {
    status: 500,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
