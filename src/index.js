/**
 * Consolidated Image CDN Worker
 * All functionality in a single file for easier deployment to Cloudflare Workers
 */

// ====== CORS UTILITIES ======
/**
 * Creates CORS headers for cross-origin requests
 * @returns {Object} CORS headers
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ====== HEALTH CHECK HANDLER ======
/**
 * Creates a health check response
 * @param {Object} corsHeaders - CORS headers to include in response
 * @returns {Response} Health check response
 */
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

// ====== PLACEHOLDER HANDLERS ======
/**
 * Creates a SVG placeholder image
 * @param {Object} corsHeaders - CORS headers to include in response
 * @returns {Response} SVG placeholder response
 */
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

/**
 * Creates an error placeholder SVG with the error message
 * @param {string} path - Image path that failed to load
 * @param {Object} corsHeaders - CORS headers to include in response
 * @param {string} errorMessage - Optional error message to display
 * @returns {Response} Error SVG response
 */
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

// ====== ERROR HANDLER ======
/**
 * Handles worker errors and returns a structured error response
 * @param {Error} err - The error that occurred
 * @param {Object} corsHeaders - CORS headers to include in response
 * @returns {Response} Structured error response
 */
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

// ====== IMAGE HANDLER ======

// Added debug mode for worker
const DEBUG_WORKER = true;

/**
 * Normalizes storage paths to ensure consistent formatting
 * This is a JavaScript version of the TypeScript util since workers use plain JS
 * 
 * @param {string} path Storage path to normalize
 * @returns {string} Normalized path without duplicate bucket prefixes
 */
function normalizeStoragePath(path) {
  if (!path) return '';
  
  // Normalize slashes - ensure path doesn't start with slash for consistent joining
  let normalizedPath = path.trim();
  normalizedPath = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
  
  // Remove duplicate bucket prefixes
  const bucketName = 'website-images';
  const bucketPrefix = `${bucketName}/`;
  
  // If path contains multiple bucket prefixes, normalize it
  if (normalizedPath.includes(bucketPrefix)) {
    // Split by bucket prefix to identify duplicates
    const parts = normalizedPath.split(bucketPrefix);
    
    // If we have more than one part after splitting (excluding first empty part if any),
    // it means we have at least one bucket prefix
    if (parts.length > 1) {
      // Join all non-empty parts after the first occurrence of the bucket prefix
      const pathWithoutDuplicates = parts.slice(1).filter(Boolean).join('/');
      return `${bucketPrefix}${pathWithoutDuplicates}`;
    }
  }
  
  // If no bucket prefix found, path is already normalized or needs prefix
  if (!normalizedPath.startsWith(bucketPrefix)) {
    return `${bucketPrefix}${normalizedPath}`;
  }
  
  // Path already has exactly one bucket prefix
  return normalizedPath;
}

/**
 * Constructs a properly formatted CDN path
 * Ensures path always has the format: website-images/image-path.ext
 * 
 * @param {string} storagePath The raw storage path
 * @returns {string} A properly formatted CDN path
 */
function constructCdnPath(storagePath) {
  // Normalize first to ensure consistency and remove any duplicate prefixes
  const normalizedPath = normalizeStoragePath(storagePath);
  
  // Ensure the normalized path includes the bucket name exactly once
  const bucketName = 'website-images';
  if (!normalizedPath.startsWith(`${bucketName}/`)) {
    return `${bucketName}/${normalizedPath.replace(`${bucketName}/`, '')}`;
  }
  
  return normalizedPath;
}

/**
 * Determines if a path is an image request
 * @param {string} pathname - URL pathname to check
 * @returns {boolean} True if the path is an image request
 */
function isImageRequest(pathname) {
  // Enhanced path detection for better matching
  return pathname.startsWith('/images/') || 
    pathname.startsWith('/website-images/') ||
    pathname.match(/\/\d+\-ChatGPT\-Image/) ||  // Handle timestamps with ChatGPT image paths
    pathname.includes('/storage/v1/object/public') ||
    pathname.startsWith('/lovable-uploads/');
}

/**
 * Constructs the origin URL to fetch the image from
 * @param {URL} url - Request URL
 * @returns {string} Origin URL
 */
function constructOriginUrl(url) {
  // Get the path and normalize it
  let path = url.pathname;
  
  // If the URL already contains the Supabase domain, extract just the path
  if (path.includes('/storage/v1/object/public')) {
    // It's already a Supabase URL - parse out the path after 'public'
    const pathParts = path.split('/public/');
    if (pathParts.length >= 2) {
      // Normalize the path after '/public/'
      const storagePath = pathParts[1];
      const normalizedPath = normalizeStoragePath(storagePath);
      
      // Reconstruct the full path with normalized storage path
      const fullPath = `/storage/v1/object/public/${normalizedPath}${url.search}`;  // Include query parameters
      
      if (DEBUG_WORKER) console.log(`[CDN Worker] Supabase URL detected, normalized path: ${fullPath}`);
      return `https://eukenximajiuhrtljnpw.supabase.co${fullPath}`;
    }
    
    // Fallback for unexpected format
    const fullPath = path + url.search;
    if (DEBUG_WORKER) console.log(`[CDN Worker] Supabase URL detected, using path: ${fullPath}`);
    return `https://eukenximajiuhrtljnpw.supabase.co${fullPath}`;
  } 
  // Special case for placeholder.svg
  else if (path.includes('placeholder.svg')) {
    if (DEBUG_WORKER) console.log(`[CDN Worker] Placeholder SVG detected`);
    return url.href;
  }
  else {
    // Regular images path - normalize first
    // Remove any leading slash for consistent normalization
    const pathWithoutLeadingSlash = path.startsWith('/') ? path.substring(1) : path;
    const normalizedPath = normalizeStoragePath(pathWithoutLeadingSlash);
    
    // Ensure the path is properly formatted for Supabase
    const formattedPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
    
    // Construct the Supabase URL with normalized path
    const supabasePath = `/storage/v1/object/public${formattedPath}${url.search}`;
    
    if (DEBUG_WORKER) {
      console.log(`[CDN Worker] Constructing Supabase URL:`, {
        originalPath: path,
        normalizedPath: normalizedPath,
        formattedPath: formattedPath,
        supabasePath: supabasePath
      });
    }
    
    return `https://eukenximajiuhrtljnpw.supabase.co${supabasePath}`;
  }
}

/**
 * Fetches an image with retry logic
 * @param {string} url - URL to fetch
 * @param {Request} request - Original request
 * @param {number} maxAttempts - Maximum number of retry attempts
 * @returns {Response|null} Fetch response or null if failed
 */
async function fetchWithRetry(url, request, maxAttempts = 2) {
  let attempts = 0;
  let response = null;
  
  // Special case for placeholder.svg - don't try to fetch from Supabase
  if (url.includes('placeholder.svg')) {
    return null; // Return null to trigger our placeholder generator
  }
  
  while (attempts < maxAttempts) {
    try {
      if (DEBUG_WORKER) console.log(`[CDN Worker] Attempt ${attempts + 1} to fetch: ${url}`);
      
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
      
      if (DEBUG_WORKER) {
        console.log(`[CDN Worker] Response for ${url}: Status ${response.status}, Content-Type: ${response.headers.get('content-type')}`);
      }
      
      // If successful, break out of retry loop
      if (response.ok) break;
      
      // If not found, no need to retry
      if (response.status === 404) {
        console.error(`[CDN Worker] 404 Not Found: ${url}`);
        break;
      }
      
      console.log(`[CDN Worker] Attempt ${attempts + 1} failed with status ${response.status}`);
      
    } catch (fetchError) {
      console.error(`[CDN Worker] Attempt ${attempts + 1} failed: ${fetchError.message}`);
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

/**
 * Handles image requests
 * @param {URL} url - Request URL
 * @param {Request} request - Original request
 * @param {Object} corsHeaders - CORS headers to include in response
 * @returns {Promise<Response>} Response with the image or error
 */
async function handleImageRequest(url, request, corsHeaders) {
  try {
    // Extract the path to forward to origin
    const imagePath = url.pathname;
    
    // Determine the origin URL to fetch
    let originUrl = constructOriginUrl(url);
    
    if (DEBUG_WORKER) console.log(`[CDN Worker] Forwarding request to: ${originUrl}`);
    
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
      
      // Debug info about the successful response
      if (DEBUG_WORKER) {
        console.log(`[CDN Worker] Successfully served: ${imagePath}`);
        console.log(`[CDN Worker] Content-Type: ${newHeaders.get('Content-Type')}`);
        console.log(`[CDN Worker] Content-Length: ${newHeaders.get('Content-Length')}`);
      }
      
      // Return the response with the updated headers
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    } else {
      // Get error status or default to 404
      const errorStatus = response ? response.status : 404;
      const errorMessage = response ? `Origin returned ${response.status}` : 'Image not found';
      
      console.error(`[CDN Worker] Error serving ${imagePath}: ${errorMessage}`);
      
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
    console.error(`[CDN Worker] Error handling image request for ${url.pathname}:`, error);
    
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

// ====== MAIN REQUEST HANDLER ======
/**
 * Main handler for all incoming requests
 * @param {Request} request - The incoming request
 * @returns {Promise<Response>} The response to send back
 */
async function handleRequest(request) {
  // Get CORS headers for cross-origin requests
  const corsHeaders = getCorsHeaders();

  // Handle OPTIONS request for CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    
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

// Register the fetch event handler
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
