import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Gemini 3.8 Flash is the primary structured OCR engine.
const GEMINI_MODEL = 'gemini-3.8-flash'

const EXTRACTION_PROMPT = `Inspect the entire image. It may contain one, two, or more Malaysian lorry punch cards (handwritten daily timesheets), including cards placed side-by-side, above one another, tilted, or partly overlapping. Each physical card normally covers half a month. Treat every separate physical punch card as a separate item and do not merge cards while reading them.

First decide whether the image contains at least one recognizable punch card. Then extract every readable row from every card and return ONLY this JSON structure:

{
  "is_punch_card_image": true,
  "error": null,
  "cards": [
    {
      "card_index": 1,
      "lori_id": "vehicle/lorry ID written on this card (e.g. LD, LD2), or null",
      "error": null,
      "entries": [
        { "day": 1, "time_in": "0730", "rest_out": "1300", "rest_in": "1400", "time_out": "1900", "rain": false }
      ]
    }
  ]
}

Rules:
- Find and read ALL separate punch cards visible anywhere in the image. A first-half card and a second-half card must be returned as two card objects, even when they have the same lorry ID.
- Never copy a lorry ID from one card to another. Read each card's ID independently and use null when it is absent or illegible.
- If the image is not a punch card/timesheet, return is_punch_card_image=false, cards=[], and a concise helpful error explaining that a punch-card image is required.
- If punch cards are present but no daily row can be read reliably because the image is too blurry, obstructed, dark, cropped, or messy, return is_punch_card_image=true, cards=[], and a concise helpful error asking for a clearer image.
- If only one card is unreadable but another is readable, include the readable card and put a concise warning in the unreadable card's error field. Never invent data.
- "day" is the day of the month (1-31), the number at the start of the row.
- Return all four time fields on every entry: "time_in", "rest_out", "rest_in", and "time_out". Use null only for fields that are not written or are illegible.
- "time_in" is the first start-of-work punch. "time_out" is the FINAL end-of-day punch, normally the rightmost written time in the row. Never mistake the afternoon return time for the final time_out.
- "rest_out" is the midday/lunch clock-out and "rest_in" is the return-to-work punch after that rest.
- Common printed columns are "Before Noon: In, Out", "After Noon: In, Out", and "Overtime: In, Out". For a row like 9:00 | 1:00 | 2:00 | [blank] | [blank] | 6:00, return time_in="0900", rest_out="1300", rest_in="1400", time_out="1800".
- All times must be 24-hour "HHMM" strings. Use the printed column and chronological order to convert implied afternoon/evening times: midday 1:00 -> "1300", afternoon 2:00 -> "1400", final 6:00 -> "1800".
- Read each row horizontally across the full width of the table before moving to the next row, including the far-right Overtime Out column.
- If handwriting is illegible, use null. NEVER invent an illegible value.
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
              },
            }),
          }
        )
        const result = await response.json()
        const raw = result.candidates?.[0]?.content?.parts?.[0]?.text
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed.is_punch_card_image === false) {
            return new Response(
              JSON.stringify({ error: parsed.error || 'This image does not appear to contain a punch card.' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 422 }
            )
          }

          if (Array.isArray(parsed.cards)) {
            const cards = parsed.cards.map((card, index) => ({
              card_index: Number(card?.card_index) || index + 1,
              lori_id: card?.lori_id ?? null,
              error: card?.error ?? null,
              entries: Array.isArray(card?.entries) ? card.entries : [],
            }))
            const usableCards = cards.filter((card) => card.entries.length > 0)

            if (usableCards.length === 0) {
              const cardError = cards.map((card) => card.error).find(Boolean)
              return new Response(
                JSON.stringify({ error: parsed.error || cardError || 'No readable punch-card rows were found. Please upload a clearer, well-lit image.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 422 }
              )
            }

            const entries = usableCards.flatMap((card) => card.entries)
            const loriIds = [...new Set(usableCards.map((card) => card.lori_id).filter(Boolean).map(String))]
            const warnings = cards.map((card) => card.error).filter(Boolean)
            console.log(`GEMINI OK: ${usableCards.length}/${cards.length} cards, ${entries.length} entries, lori_ids=${loriIds.join(',')}`)
            return new Response(
              JSON.stringify({
                engine: 'gemini',
                cards: usableCards,
                lori_id: loriIds.length === 1 ? loriIds[0] : null,
                entries,
                warnings,
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            )
          }

          // Backward compatibility while older clients are still in use.
          if (Array.isArray(parsed.entries)) {
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
