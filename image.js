addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Configure your Supabase URL here
  const SUPABASE_URL = "https://[YOUR-PROJECT-ID].supabase.co/storage/v1/object/public/website-images"
  
  // Get the URL pathname (e.g., "/images/hero.jpg")
  const url = new URL(request.url)
  const pathname = url.pathname
  
  // Create the Supabase storage URL
  const supabaseImageUrl = `${SUPABASE_URL}${pathname}`
  
  // Forward the request to Supabase
  let response = await fetch(supabaseImageUrl, {
    cf: {
      // Cache on Cloudflare's edge for 1 day
      cacheTtl: 86400,
      cacheEverything: true
    },
    headers: request.headers
  })
  
  // Clone the response so we can modify headers
  response = new Response(response.body, response)
  
  // Add cache headers
  response.headers.set('Cache-Control', 'public, max-age=86400')
  
  return response
}
