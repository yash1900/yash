/**
 * Image CDN Worker
 * Modular implementation for better maintainability
 */
import { getCorsHeaders } from './workers/imageCdn/corsUtils';
import { createHealthCheckResponse } from './workers/imageCdn/handlers/healthCheckHandler';
import { createPlaceholderSvg } from './workers/imageCdn/handlers/placeholderHandler';
import { handleWorkerError } from './workers/imageCdn/handlers/errorHandler';
import { isImageRequest, handleImageRequest } from './workers/imageCdn/handlers/imageHandler';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

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
