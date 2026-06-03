const MAX_TRANSLATION_CHARS = 12000
const BCRA_CITATION_PATTERN = /\[BCRA\s*•[^\]]+\]/g

function isValidLanguage(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 80
}

function normalizeCitationSpacing(text) {
  return String(text || "")
    .replace(/([^\s(\[])(\[BCRA\s*•[^\]]+\])/g, "$1 $2")
    .replace(/(\[BCRA\s*•[^\]]+\])(\[BCRA\s*•[^\]]+\])/g, "$1 $2")
    .replace(/(\[BCRA\s*•[^\]]+\])([^\s\]\).,;:!?])/g, "$1\n\n$2")
    .replace(/[ \t]{2,}(\[BCRA\s*•[^\]]+\])/g, " $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: "Server is missing OPENAI_API_KEY" })
    }

    const { text, targetLanguage } = req.body || {}

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text to translate" })
    }

    if (!isValidLanguage(targetLanguage)) {
      return res.status(400).json({ error: "Invalid target language" })
    }

    if (text.length > MAX_TRANSLATION_CHARS) {
      return res.status(413).json({
        error: `Translation is too long. Please limit responses to ${MAX_TRANSLATION_CHARS} characters.`,
      })
    }

    const citations = text.match(BCRA_CITATION_PATTERN) || []

    const systemPrompt = targetLanguage === "Medu Neter"
      ? [
          "You are assisting Jabril AI with post-response language rendering.",
          "Render the supplied response in a Medu Neter / Ancient Egyptian-oriented format where reasonably possible.",
          "Preserve all Markdown-style structure, headings, bullets, paragraph breaks, and line breaks.",
          "Preserve the spacing before and after every citation. Citations must never be merged into surrounding words.",
          "Do not invent archive claims or new citations.",
          "Do not translate, alter, remove, or reformat any bracketed citation such as [BCRA • Document Title].",
          "Preserve Unicode hieroglyphs, transliterations, pronunciations, and meanings where present.",
          "Return only the transformed response text with no preamble.",
        ].join("\n")
      : [
          `You are a professional translator. Translate the supplied response into ${targetLanguage}.`,
          "Preserve all Markdown-style structure, headings, bullets, paragraph breaks, and line breaks.",
          "Preserve the spacing before and after every citation. Citations must never be merged into surrounding words.",
          "Do not summarize, reinterpret, add claims, remove claims, or add outside knowledge.",
          "Do not translate, alter, remove, or reformat any bracketed citation such as [BCRA • Document Title].",
          "Return only the translated response text with no preamble.",
        ].join("\n")

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
      }),
    })

    const data = await openaiRes.json().catch(() => null)

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        error: data?.error?.message || "OpenAI translation request failed",
      })
    }

    let translation = normalizeCitationSpacing(data?.choices?.[0]?.message?.content || text)

    // Safety check: if the model accidentally drops an exact BCRA citation,
    // append any missing citations so source references are never lost.
    for (const citation of citations) {
      if (!translation.includes(citation)) {
        translation = `${translation}\n\n${citation}`
      }
    }

    return res.status(200).json({ translation })
  } catch (error) {
    console.error("Translation route error:", error)
    return res.status(500).json({ error: "Translation failed" })
  }
}
