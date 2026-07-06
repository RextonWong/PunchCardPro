import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Change this to a newer model (e.g. a Gemini 3.x flash model) once your
// key has access — nothing else needs to change.
const GEMINI_MODEL = 'gemini-2.5-flash'

const EXTRACTION_PROMPT = `This image is a Malaysian lorry punch card (a handwritten daily timesheet). Each row is one day of the month, usually with a clock-in time and a clock-out time. Some rows say "rain" or "hujan" (Malay for rain) instead of, or in addition to, the times.

Extract every row that contains any data and return ONLY this JSON structure:

{
  "lori_id": "vehicle/lorry ID written on the card (e.g. LD, LD2), or null",
  "entries": [
    { "day": 1, "time_in": "0730", "time_out": "1900", "rain": false }
  ]
}

Rules:
- "day" is the day of the month (1-31), the number at the start of the row.
- "time_in" and "time_out" are 24-hour "HHMM" strings. Convert 12-hour notation: 7am -> "0700", 7.30pm -> "1930".
- If a time is illegible or not written, use null. NEVER guess an illegible value.
- "rain" is true if the row mentions rain or hujan in any form.
- Skip completely empty rows.
- Output raw JSON only. No markdown, no explanation.`

serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image } = await req.json()
    const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')
    const GOOGLE_KEY = Deno.env.get('GOOGLE_VISION_API_KEY')

    // 2. Primary engine: Gemini reads the card with context and returns
    //    structured rows directly — far better on messy handwriting.
    if (GEMINI_KEY) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: 'image/jpeg', data: image } },
                  { text: EXTRACTION_PROMPT },
                ],
              }],
              generationConfig: {
                response_mime_type: 'application/json',
                temperature: 0,
              },
            }),
          }
        )
        const result = await response.json()
        const raw = result.candidates?.[0]?.content?.parts?.[0]?.text
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed.entries)) {
            console.log(`GEMINI OK: ${parsed.entries.length} entries, lori_id=${parsed.lori_id}`)
            return new Response(
              JSON.stringify({ engine: 'gemini', lori_id: parsed.lori_id ?? null, entries: parsed.entries }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            )
          }
        }
        console.error('GEMINI unexpected response:', JSON.stringify(result).slice(0, 500))
      } catch (geminiErr) {
        console.error('GEMINI FAILED, falling back to Vision:', geminiErr.message)
      }
    }

    // 3. Fallback engine: Google Vision raw text (frontend regex parses it)
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

    if (result.responses?.[0]?.error) {
      console.error("GOOGLE API ERROR:", result.responses[0].error.message);
    }

    const detectedText = result.responses?.[0]?.fullTextAnnotation?.text || "";

    return new Response(JSON.stringify({ engine: 'vision', text: detectedText }), {
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
