import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image } = await req.json()
    const GOOGLE_KEY = Deno.env.get('GOOGLE_VISION_API_KEY')

    // DEBUG: Confirm data made it into the function
    console.log("SENDING TO GOOGLE. Data length:", image?.length);

    // 2. Call Google Vision API
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_KEY}`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            image: { content: image },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            // Punch cards mix English and Malay ("hujan") — hinting the
            // languages improves Vision's handwriting recognition accuracy
            imageContext: { languageHints: ['en', 'ms'] }
          }]
        })
      }
    )

    const result = await response.json()
    
    // 3. CRITICAL LOG: Print exactly what Google sent back
    console.log("FULL GOOGLE RESPONSE:", JSON.stringify(result));

    // 4. Catch silent Google errors (like billing or bad API keys)
    if (result.responses?.[0]?.error) {
      console.error("GOOGLE API ERROR:", result.responses[0].error.message);
    }

    // 5. Safely extract the text
    const detectedText = result.responses?.[0]?.fullTextAnnotation?.text || "";

    return new Response(JSON.stringify({ text: detectedText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("EDGE FUNCTION CRASH:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})