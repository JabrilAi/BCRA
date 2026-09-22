import { useState, useRef, useEffect } from "react"
import { createClient } from "@supabase/supabase-js"
import logo from "../JAI-Logo-web.png"

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://zvwtutvjdskkmfzfcfzx.supabase.co",
  import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2d3R1dHZqZHNra21memZjZnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2NzA5NDcsImV4cCI6MjA3MDI0Njk0N30.Ods_WduSQhHY0YU-v9TNY_HjZGA6FSCVkNFvl539z_w"
)

// Capture the Android/Chrome install prompt as early as possible.
// Guarded so Vercel/SSR builds never crash on "window is not defined".
let _installPrompt = null
if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault()
        _installPrompt = e
    })
}

const FREE_LIMIT = 10
const STORAGE_KEY = "jabrilai_questions_used"
const REGISTERED_KEY = "jabrilai_has_registered"

function isPWA() {
    return window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
}

// ─── Anonymous question counter (browser storage) ────────────────────────────
function getAnonCount() {
    return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10)
}
function incrementAnonCount() {
    const next = getAnonCount() + 1
    localStorage.setItem(STORAGE_KEY, String(next))
    return next
}

// ─── Supabase helpers (for logged-in users) ───────────────────────────────────
async function getQuestionsUsed(userId) {
    const { data } = await supabase.from("profiles").select("questions_used").eq("id", userId).single()
    return data?.questions_used ?? 0
}

async function incrementQuestions(userId) {
    const { data } = await supabase.from("profiles").select("questions_used").eq("id", userId).single()
    const next = (data?.questions_used ?? 0) + 1
    await supabase.from("profiles").update({ questions_used: next }).eq("id", userId)
    return next
}

async function dbGetSessions(userId) {
    const { data } = await supabase
        .from("chat_sessions")
        .select("id, title, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20)
    return data ?? []
}

async function dbCreateSession(userId, title) {
    const { data, error } = await supabase
        .from("chat_sessions")
        .insert({ user_id: userId, title })
        .select("id, title, created_at")
        .single()
    if (error) throw error
    return data
}

async function dbGetMessages(sessionId) {
    const { data } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
    return data ?? []
}

async function dbSaveMessage(sessionId, userId, role, msgContent) {
    const { error } = await supabase.from("chat_messages").insert({
        session_id: sessionId,
        role: role,
        content: msgContent,
    })
    if (error) console.error("dbSaveMessage error:", error.message, error.details, error.hint)
}

// Delete a single session. Messages are deleted first (explicitly, so this
// works whether or not the DB has an ON DELETE CASCADE set up), then the
// session row itself, scoped to user_id so a user can only ever delete
// their own data even if called with an unexpected id.
async function dbDeleteSession(sessionId, userId) {
    const { error: msgErr } = await supabase
        .from("chat_messages")
        .delete()
        .eq("session_id", sessionId)
    if (msgErr) {
        console.error("dbDeleteSession (messages) error:", msgErr.message, msgErr.details, msgErr.hint)
        throw msgErr
    }
    const { error: sessErr } = await supabase
        .from("chat_sessions")
        .delete()
        .eq("id", sessionId)
        .eq("user_id", userId)
    if (sessErr) {
        console.error("dbDeleteSession (session) error:", sessErr.message, sessErr.details, sessErr.hint)
        throw sessErr
    }
}

// Delete every session (and its messages) belonging to this user.
async function dbDeleteAllSessions(userId) {
    const sessions = await dbGetSessions(userId)
    if (sessions.length === 0) return
    const ids = sessions.map(s => s.id)
    const { error: msgErr } = await supabase
        .from("chat_messages")
        .delete()
        .in("session_id", ids)
    if (msgErr) {
        console.error("dbDeleteAllSessions (messages) error:", msgErr.message, msgErr.details, msgErr.hint)
        throw msgErr
    }
    const { error: sessErr } = await supabase
        .from("chat_sessions")
        .delete()
        .eq("user_id", userId)
    if (sessErr) {
        console.error("dbDeleteAllSessions (sessions) error:", sessErr.message, sessErr.details, sessErr.hint)
        throw sessErr
    }
}

// ─── Constants & utilities (unchanged) ───────────────────────────────────────
const WEBHOOK_URL = "https://anthonyai.app.n8n.cloud/webhook/11"
const DOCUMENT_WEBHOOK_URL =
    import.meta.env.VITE_DOCUMENT_WEBHOOK_URL ||
    "https://anthonyai.app.n8n.cloud/webhook/jabril-document"

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const MAX_DOCUMENT_TEXT_CHARS = 80000
const ACCEPTED_DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "csv", "xls", "xlsx"]
const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.csv,.xls,.xlsx"

// Creator-only podcast endpoint. The server-side n8n workflow is the
// authoritative authorization boundary; this client-side ID only controls
// whether the creator UI is shown.
const PODCAST_WEBHOOK_URL =
    import.meta.env.VITE_PODCAST_WEBHOOK_URL ||
    "https://anthonyai.app.n8n.cloud/webhook/jabril-podcast"
const PODCAST_CREATOR_ID = import.meta.env.VITE_PODCAST_CREATOR_ID || ""

const DIVE_DEEPER_ENABLED = true // capped at 2 Supabase Retrieve Tool calls per the n8n system prompt

// ─── Curator Mode instructions now live securely in n8n ─────────────────────
const GOLD   = "#c9a84c"
const BG     = "#0f0f0f"
const PANEL  = "#161616"
const BORDER = "#2a2a2a"
const TEXT   = "#e4dfd4"
const MUTED  = "#5a5650"

// ─── Contribute (Stripe Payment Link) ───────────────────────────────────────
// Live Stripe Payment Link ("Customers choose what to pay", $25 preset, $3 minimum).
// This is the only place to change the link.
const CONTRIBUTE_URL = "https://buy.stripe.com/4gM14meLVdg9euLeA03sI00"

// The Stripe link sends people back here with ?contributed=1. Read it once at
// load, then strip it from the address bar so a refresh doesn't repeat the message.
let _justContributed = false
if (typeof window !== "undefined") {
    try {
        const url = new URL(window.location.href)
        if (url.searchParams.get("contributed") === "1") {
            _justContributed = true
            url.searchParams.delete("contributed")
            window.history.replaceState({}, "", url.pathname + url.search + url.hash)
        }
    } catch (e) { /* non-critical */ }
}

// Answers only. Errors, "empty session" and the loading placeholder also use the "ai"
// role, but a request to contribute doesn't belong after those.
function isAnswerMessage(msg) {
    return msg.role === "ai" && !/^(e-|empty$|err$)/.test(String(msg.id))
}

// Shown under every Jabril answer. Lives outside the message text, so Share, Print
// and Translate (which work from msg.text) never include it.
function ContributeNote({ isMobile }) {
    return (
        <div style={{
            marginTop: 22,
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: isMobile ? 10 : 16,
        }}>
            <span style={{ fontSize: 13, lineHeight: 1.6, color: "#9a9590" }}>
                If this information helped you please consider contributing to preserve and expand the archive.
            </span>
            <a
                href={CONTRIBUTE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                    display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
                    background: "transparent", border: `1px solid ${GOLD}66`, borderRadius: 8,
                    color: GOLD, fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                    padding: "7px 14px", textDecoration: "none", cursor: "pointer", whiteSpace: "nowrap",
                    transition: "background 0.2s, border-color 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${GOLD}18`; e.currentTarget.style.borderColor = GOLD }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = `${GOLD}66` }}
            >
                <span style={{ fontSize: 14 }}>♡</span> Contribute
            </a>
        </div>
    )
}

function ContributeThanks() {
    const [show, setShow] = useState(_justContributed)
    useEffect(() => {
        if (!show) return
        _justContributed = false
        const t = setTimeout(() => setShow(false), 9000)
        return () => clearTimeout(t)
    }, [show])
    if (!show) return null
    return (
        <div role="status" aria-live="polite" style={{
            position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
            zIndex: 200, maxWidth: "calc(100vw - 32px)",
            display: "flex", alignItems: "center", gap: 12,
            background: "#1a1a1a", border: `1px solid ${GOLD}66`, borderRadius: 10,
            padding: "12px 16px", color: TEXT, fontSize: 14, lineHeight: 1.4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
            <span>Thank you for contributing. You're helping preserve and expand the archive.</span>
            <button
                onClick={() => setShow(false)}
                aria-label="Dismiss"
                style={{ background: "transparent", border: "none", color: MUTED, cursor: "pointer", fontSize: 14, padding: 0, fontFamily: "inherit" }}
            >
                ✕
            </button>
        </div>
    )
}

const EXAMPLE_QUESTIONS = [
    "Who were the Moors and how did they shape Europe?",
    "How do Black women navigate love and partnership?",
    "How do I make a traditional West African peanut stew?",
    "What is Kemetic spirituality?",
    "What are the best anti-inflammatory foods for Black bodies?",
    "How can Black couples keep their relationships strong?",
    "What did Marcus Garvey believe?",
    "Can you share a recipe for Jollof rice?",
    "How do you rebuild trust after betrayal in a relationship?",
    "What foods did West Africans eat before colonization?",
    "What is Ubuntu philosophy and how does it apply today?",
    "How do I deal with stress and anxiety as a Black person?",
    "What are traditional African relationship values?",
    "How do I make an authentic Egusi soup?",
    "Who was Cheikh Anta Diop and why does he matter?",
    "What does it mean to truly love yourself first?",
    "What African herbs and plants have healing properties?",
    "What are practical ways to build generational wealth?",
    "How does the Black church influence relationships?",
    "What is a good recipe for black-eyed peas and rice?",
    "What is the history of Juneteenth?",
    "What foods support melanin and skin health?",
    "What are healthy boundaries in a relationship?",
    "How did the Black Panthers address community health?",
    "Who are the Original people of the planet and why does it matter?",
    "How can I raise confident Black children?",
    "What did soul food mean to enslaved Black Americans?",
    "What can Black men learn from African rites of passage?",
    "How do I make a healing turmeric and ginger drink?",
    "How does systemic racism affect Black health outcomes?",
    "What healing foods come from African traditions?",
    "What does financial freedom look like for Black families?",
]

function cleanMarkdown(text) {
    return text
        .replace(/###\s*/g, "").replace(/##\s*/g, "").replace(/#\s*/g, "")
        .replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1")
        .replace(/^\s*[-•]\s*/gm, "\n• ").replace(/\n{3,}/g, "\n\n")
        // Strip LaTeX math notation
        .replace(/\\\(|\\\)/g, "")
        .replace(/\\\[/g, "").replace(/\\\]/g, "")
        .replace(/\\times/g, "×")
        .replace(/\\cdot/g, "·")
        .replace(/\\div/g, "÷")
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1/$2")
        .replace(/\\sqrt\{([^}]+)\}/g, "√$1")
        .trim()
}

function shareMessage(question, answer) {
    const text = `Jabril AI — Black Civilization Research Archive\n\nQuestion: ${question}\n\nAnswer:\n${answer}`
    if (navigator.share) {
        navigator.share({ title: "Jabril AI", text })
    } else {
        navigator.clipboard.writeText(text)
        alert("Copied to clipboard!")
    }
}

// Single source → strip all inline occurrences and append once at the end.
// Multiple sources → deduplicate but leave each in place (they render on their
// own line via the display:block span style).
function deduplicateCitations(text) {
    // Treat a BCRA citation plus an optional "— Author" suffix as one source-credit unit.
    // This preserves author display metadata while keeping the exact [BCRA • Source Name]
    // citation tag unchanged for source fidelity.
    const splitMatch = String(text || "").match(/\n*Sources Used:[\s\S]*$/i)
    let body = text
    let sourcesBlock = ""
    if (splitMatch) {
        body = text.slice(0, splitMatch.index)
        sourcesBlock = splitMatch[0].trim()
    }

    const TAG_PATTERN = /\[BCRA\s*•[^\]]+\]/g
    const CREDIT_PATTERN = /\[BCRA\s*•[^\]]+\](?:[ \t]*—[ \t]*[^\n]+)?/g

    function getTag(credit) {
        const match = String(credit || "").match(/\[BCRA\s*•[^\]]+\]/)
        return match ? match[0].trim() : ""
    }

    function hasAuthor(credit) {
        return /\]\s*—\s*\S/.test(String(credit || ""))
    }

    // Prefer the richest version of each source credit (citation + author when available).
    const creditByTag = new Map()
    const allCredits = [
        ...[...body.matchAll(CREDIT_PATTERN)].map(m => m[0].trim()),
        ...[...sourcesBlock.matchAll(CREDIT_PATTERN)].map(m => m[0].trim()),
    ]

    for (const credit of allCredits) {
        const tag = getTag(credit)
        if (!tag) continue
        const existing = creditByTag.get(tag)
        if (!existing || (!hasAuthor(existing) && hasAuthor(credit))) {
            creditByTag.set(tag, credit)
        }
    }

    const uniqueTags = [...creditByTag.keys()]

    if (uniqueTags.length === 0) {
        return sourcesBlock ? (body.trim() + "\n\n" + sourcesBlock) : text
    }

    function enrichSourcesBlock(block) {
        if (!block) return ""
        return block.replace(CREDIT_PATTERN, (credit) => {
            const tag = getTag(credit)
            return creditByTag.get(tag) || credit
        })
    }

    let newBody

    if (uniqueTags.length === 1) {
        // One source — remove inline repeats and show one complete source credit at the end
        // (or enrich the existing Sources Used block with the author suffix).
        newBody = body.replace(CREDIT_PATTERN, "")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim()

        if (!sourcesBlock) {
            newBody += "\n\n" + creditByTag.get(uniqueTags[0])
        }
    } else {
        // Multiple sources — deduplicate by exact citation tag while preserving the author suffix.
        const seen = new Set()
        newBody = body.replace(CREDIT_PATTERN, (credit) => {
            const tag = getTag(credit)
            if (!tag) return credit
            if (seen.has(tag)) return ""
            seen.add(tag)
            return creditByTag.get(tag) || credit
        }).replace(/[ \t]{2,}/g, " ").trim()
    }

    const enrichedSources = enrichSourcesBlock(sourcesBlock)
    return enrichedSources ? (newBody + "\n\n" + enrichedSources) : newBody
}

function escapeHTML(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

function printConversation(messages) {
    const content = messages
        .filter(m => m.role !== "loading")
        .map(m => `<div class="${m.role}"><strong>${m.role === "user" ? "You" : "Jabril AI"}</strong><p>${escapeHTML(m.text).replace(/\n/g, "<br/>")}</p></div>`)
        .join("")
    const win = window.open("", "_blank")
    win.document.write(`
        <html><head><title>Jabril AI Research Session</title>
        <style>
            body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; padding: 0 24px; color: #111; }
            h1 { font-size: 20px; color: #c9a84c; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
            .user { margin: 24px 0 8px; }
            .user strong { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #c9a84c; }
            .ai { margin: 8px 0 24px; border-bottom: 1px solid #eee; padding-bottom: 24px; }
            .ai strong { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; }
            p { line-height: 1.8; margin: 8px 0; }
        </style></head>
        <body><h1>Jabril AI — Black Civilization Research Archive</h1>${content}</body></html>
    `)
    win.document.close()
    win.print()
}

function getFileExtension(name = "") {
    return String(name).split(".").pop()?.toLowerCase() || ""
}

function validateDocument(file) {
    if (!file) return "Choose a document to upload."
    const extension = getFileExtension(file.name)
    if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
        return "Use a PDF, Word (.docx), text, CSV, or Excel file."
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
        return "Documents must be 10 MB or smaller."
    }
    return ""
}

async function inflateZipEntry(bytes, method) {
    if (method === 0) return bytes
    if (method !== 8) throw new Error("This Word document uses an unsupported compression method.")
    if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser cannot read Word files. Save the document as PDF and try again.")
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

// DOCX is a ZIP package. Read only word/document.xml in the browser so the
// original private file never needs third-party conversion or permanent storage.
async function extractDocxText(file) {
    const buffer = await file.arrayBuffer()
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    const decoder = new TextDecoder("utf-8")

    let endOffset = -1
    const scanStart = Math.max(0, bytes.length - 65557)
    for (let offset = bytes.length - 22; offset >= scanStart; offset -= 1) {
        if (view.getUint32(offset, true) === 0x06054b50) {
            endOffset = offset
            break
        }
    }
    if (endOffset < 0) throw new Error("The Word document could not be opened.")

    const entryCount = view.getUint16(endOffset + 10, true)
    let centralOffset = view.getUint32(endOffset + 16, true)
    let documentEntry = null

    for (let index = 0; index < entryCount; index += 1) {
        if (view.getUint32(centralOffset, true) !== 0x02014b50) break
        const method = view.getUint16(centralOffset + 10, true)
        const compressedSize = view.getUint32(centralOffset + 20, true)
        const fileNameLength = view.getUint16(centralOffset + 28, true)
        const extraLength = view.getUint16(centralOffset + 30, true)
        const commentLength = view.getUint16(centralOffset + 32, true)
        const localOffset = view.getUint32(centralOffset + 42, true)
        const entryName = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + fileNameLength))

        if (entryName === "word/document.xml") {
            documentEntry = { method, compressedSize, localOffset }
            break
        }
        centralOffset += 46 + fileNameLength + extraLength + commentLength
    }

    if (!documentEntry) throw new Error("No readable document content was found in this Word file.")
    if (view.getUint32(documentEntry.localOffset, true) !== 0x04034b50) {
        throw new Error("The Word document is damaged or incomplete.")
    }

    const localNameLength = view.getUint16(documentEntry.localOffset + 26, true)
    const localExtraLength = view.getUint16(documentEntry.localOffset + 28, true)
    const dataStart = documentEntry.localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(dataStart, dataStart + documentEntry.compressedSize)
    const xmlBytes = await inflateZipEntry(compressed, documentEntry.method)
    const xml = decoder.decode(xmlBytes)
    const doc = new DOMParser().parseFromString(xml, "application/xml")
    if (doc.querySelector("parsererror")) throw new Error("The Word document contains invalid content.")

    const paragraphs = [...doc.getElementsByTagNameNS("*", "p")].map(paragraph => {
        let line = ""
        const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT)
        let node = walker.currentNode
        while (node) {
            if (node.localName === "t") line += node.textContent || ""
            if (node.localName === "tab") line += "\t"
            if (node.localName === "br") line += "\n"
            node = walker.nextNode()
        }
        return line.trimEnd()
    }).filter(Boolean)

    const text = paragraphs.join("\n\n").trim()
    if (!text) throw new Error("No readable text was found in this Word document.")
    return text.slice(0, MAX_DOCUMENT_TEXT_CHARS)
}

async function prepareDocumentUpload(file) {
    const extension = getFileExtension(file?.name)
    if (extension === "docx") {
        return { documentText: await extractDocxText(file) }
    }
    if (extension === "txt") {
        const documentText = (await file.text()).trim()
        if (!documentText) throw new Error("The text document is empty.")
        return { documentText: documentText.slice(0, MAX_DOCUMENT_TEXT_CHARS) }
    }
    return { file }
}

function safeExportName(question = "") {
    const base = String(question || "jabril-enhanced-document")
        .replace(/^📎[^\n]+\n*/u, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 54)
        .toLowerCase()
    return base || "jabril-enhanced-document"
}

function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function answerToHTML(text = "") {
    return String(text).split("\n").map(line => {
        const trimmed = line.trim()
        if (!trimmed) return '<div class="space"></div>'
        const clean = trimmed.replace(/^#{1,3}\s*/, "")
        if (/^[-•]\s+/.test(clean)) return `<p class="bullet">• ${escapeHTML(clean.replace(/^[-•]\s+/, ""))}</p>`
        if (/^\[BCRA\s*•/.test(clean)) return `<p class="citation">${escapeHTML(clean)}</p>`
        const heading = clean.length < 72 && !/[.,;:]$/.test(clean)
        return heading ? `<h2>${escapeHTML(clean)}</h2>` : `<p>${escapeHTML(clean)}</p>`
    }).join("")
}

function exportAnswerAsWord(answer, question) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{font-family:Georgia,serif;color:#171717;line-height:1.65;margin:48px;max-width:760px}
        h1{font:700 14px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9a7825;border-bottom:1px solid #d8c58d;padding-bottom:12px}
        h2{font-size:18px;color:#8a6c21;margin:22px 0 7px}.space{height:8px}p{margin:0 0 9px}
        .bullet{margin-left:18px}.citation{color:#8a6c21;font-size:10pt}
    </style></head><body><h1>Jabril AI — Enhanced Document</h1>${answerToHTML(answer)}</body></html>`
    triggerDownload(new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }), `${safeExportName(question)}.doc`)
}

function exportAnswerAsExcel(answer, question) {
    const lines = String(answer).split("\n").map(line => line.trim()).filter(Boolean)
    const tableLines = lines.filter(line => /^\|.*\|$/.test(line))
    let rows
    if (tableLines.length >= 2) {
        rows = tableLines
            .map(line => line.slice(1, -1).split("|").map(cell => cell.trim()))
            .filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)))
    } else {
        rows = [["Jabril AI — Enhanced Document"], ...lines.map(line => [line.replace(/^[-•]\s*/, "")])]
    }
    const cells = rows.map(row => `<Row>${row.map(cell => `<Cell><Data ss:Type="String">${escapeHTML(cell)}</Data></Cell>`).join("")}</Row>`).join("")
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Jabril Enhanced"><Table>${cells}</Table></Worksheet></Workbook>`
    triggerDownload(new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel;charset=utf-8" }), `${safeExportName(question)}.xls`)
}

function exportAnswerAsPDF(answer, question) {
    const win = window.open("", "_blank")
    if (!win) {
        alert("Allow pop-ups to export this answer as a PDF.")
        return
    }
    win.document.write(`<!doctype html><html><head><title>${escapeHTML(safeExportName(question))}</title><style>
        @page{margin:0.7in}body{font-family:Georgia,serif;color:#171717;line-height:1.65;margin:0}
        h1{font:700 12px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9a7825;border-bottom:1px solid #d8c58d;padding-bottom:12px}
        h2{font-size:17px;color:#8a6c21;margin:20px 0 6px}.space{height:8px}p{margin:0 0 8px}
        .bullet{margin-left:18px}.citation{color:#8a6c21;font-size:9pt}
    </style></head><body><h1>Jabril AI — Enhanced Document</h1>${answerToHTML(answer)}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 250)
}

// ─── UI Components (unchanged) ───────────────────────────────────────────────

function RotatingQuestion({ onAsk }) {
    const [index, setIndex] = useState(() => Math.floor(Math.random() * EXAMPLE_QUESTIONS.length))
    const [visible, setVisible] = useState(true)

    useEffect(() => {
        const interval = setInterval(() => {
            setVisible(false)
            setTimeout(() => {
                setIndex(prev => (prev + 1) % EXAMPLE_QUESTIONS.length)
                setVisible(true)
            }, 400)
        }, 6000)
        return () => clearInterval(interval)
    }, [])

    return (
        <div style={{ textAlign: "center", marginTop: 8 }}>
            <p style={{ color: "#7a756c", fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                Try asking
            </p>
            <button
                onClick={() => onAsk(EXAMPLE_QUESTIONS[index])}
                style={{
                    background: "transparent", border: "none", borderRadius: 100,
                    color: TEXT, fontFamily: "'Cormorant Garamond', serif",
                    fontStyle: "italic", fontSize: 26, padding: "12px 28px",
                    cursor: "pointer", maxWidth: 560, lineHeight: 1.4,
                    transition: "opacity 0.4s ease, color 0.2s",
                    opacity: visible ? 1 : 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = GOLD }}
                onMouseLeave={e => { e.currentTarget.style.color = TEXT }}
            >
                "{EXAMPLE_QUESTIONS[index]}"
            </button>
            <p style={{ color: "#7a756c", fontSize: 15, marginTop: 10 }}>or type your own question below</p>
        </div>
    )
}

function Sidebar({ history, activeId, onSelect, onNewChat, user, onSignOut, onDeleteSession, onClearAll, isMobile = false, isOpen = true, onClose }) {
    const [confirmClearAll, setConfirmClearAll] = useState(false)
    const [hoveredId, setHoveredId] = useState(null)
    const [deletingId, setDeletingId] = useState(null)
    const [clearing, setClearing] = useState(false)

    if (isMobile && !isOpen) return null

    async function handleDeleteOne(e, id) {
        e.stopPropagation() // never trigger onSelect for the row underneath
        if (deletingId) return
        setDeletingId(id)
        try {
            await onDeleteSession(id)
        } finally {
            setDeletingId(null)
        }
    }

    async function handleClearAll() {
        if (clearing) return
        setClearing(true)
        try {
            await onClearAll()
        } finally {
            setClearing(false)
            setConfirmClearAll(false)
        }
    }
    return (
        <>
            <style>{`
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes slideIn { from { transform: translateX(-100%) } to { transform: translateX(0) } }
            `}</style>
            {isMobile && (
                <div
                    onClick={onClose}
                    style={{
                        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
                        zIndex: 90, animation: "fadeIn 0.15s ease",
                    }}
                />
            )}
            <aside style={isMobile ? {
                position: "fixed", top: 0, left: 0, height: "100vh", width: "78vw", maxWidth: 300,
                minWidth: 0, background: PANEL, borderRight: `1px solid ${BORDER}`,
                display: "flex", flexDirection: "column", overflowY: "hidden",
                zIndex: 91, boxShadow: "8px 0 24px rgba(0,0,0,0.4)",
                animation: "slideIn 0.18s ease",
            } : {
                width: 220, minWidth: 220, background: PANEL,
                borderRight: `1px solid ${BORDER}`, display: "flex",
                flexDirection: "column", height: "100vh", overflowY: "hidden", flexShrink: 0,
            }}>
                {isMobile && (
                    <button
                        onClick={onClose}
                        aria-label="Close menu"
                        style={{
                            position: "absolute", top: 14, right: 14, background: "transparent",
                            border: `1px solid ${BORDER}`, borderRadius: 6, color: MUTED,
                            fontSize: 16, width: 30, height: 30, cursor: "pointer", lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                    >
                        ✕
                    </button>
                )}
            <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "center" }}>
                <img src={logo} alt="Jabril AI" onClick={onNewChat} style={{ width: 80, height: "auto", cursor: "pointer" }} />
            </div>
            <div style={{ padding: "14px 12px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
                {/* User info + Sign Out */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {user?.email}
                    </span>
                    <button
                        onClick={onSignOut}
                        style={{
                            background: "transparent", border: `1px solid ${BORDER}`,
                            borderRadius: 6, color: MUTED, fontFamily: "inherit",
                            fontSize: 11, padding: "4px 10px", cursor: "pointer",
                            whiteSpace: "nowrap", transition: "border-color 0.2s, color 0.2s", flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#c0392b"; e.currentTarget.style.color = "#c0392b" }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
                    >
                        Sign Out
                    </button>
                </div>
                {/* Divider */}
                <div style={{ borderTop: `1px solid ${BORDER}` }} />
                {/* New Research button */}
                <button onClick={() => { onNewChat(); if (isMobile && onClose) onClose() }} style={{
                    width: "100%", background: "transparent",
                    border: `1px solid ${BORDER}`, borderRadius: 8,
                    color: TEXT, fontFamily: "inherit", fontSize: 13,
                    padding: "10px 12px", cursor: "pointer", textAlign: "center",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    transition: "border-color 0.2s, color 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TEXT }}
                >
                    <span style={{ fontSize: 16 }}>+</span> New Research
                </button>
                {/* Contribute (Stripe Payment Link) */}
                <a
                    href={CONTRIBUTE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Help preserve and expand the archive"
                    onClick={() => { if (isMobile && onClose) onClose() }}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", boxSizing: "border-box",
                        background: "transparent", border: `1px solid ${GOLD}66`, borderRadius: 8,
                        color: GOLD, fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                        padding: "10px 12px", textDecoration: "none", cursor: "pointer",
                        transition: "background 0.2s, border-color 0.2s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${GOLD}18`; e.currentTarget.style.borderColor = GOLD }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = `${GOLD}66` }}
                >
                    <span style={{ fontSize: 15 }}>♡</span> Contribute
                </a>
            </div>
            <div style={{ padding: "6px 12px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: MUTED, letterSpacing: "0.12em", textTransform: "uppercase" }}>Recent</span>
                {history.length > 0 && (
                    <button
                        onClick={() => setConfirmClearAll(true)}
                        style={{
                            background: "transparent", border: "none",
                            color: MUTED, fontFamily: "inherit", fontSize: 11,
                            cursor: "pointer", padding: "2px 4px",
                            transition: "color 0.2s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = "#c0392b"}
                        onMouseLeave={e => e.currentTarget.style.color = MUTED}
                    >
                        Clear all
                    </button>
                )}
            </div>
            {confirmClearAll && (
                <div style={{ margin: "0 12px 8px", padding: "10px 12px", background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.35)", borderRadius: 8 }}>
                    <p style={{ fontSize: 12, color: TEXT, marginBottom: 10, lineHeight: 1.5 }}>
                        Delete all {history.length} research session{history.length === 1 ? "" : "s"}? This can't be undone.
                    </p>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button
                            onClick={handleClearAll}
                            disabled={clearing}
                            style={{
                                flex: 1, background: "#c0392b", border: "none", borderRadius: 6,
                                color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                                padding: "7px 10px", cursor: clearing ? "not-allowed" : "pointer",
                                opacity: clearing ? 0.6 : 1,
                            }}
                        >
                            {clearing ? "Deleting…" : "Delete All"}
                        </button>
                        <button
                            onClick={() => setConfirmClearAll(false)}
                            disabled={clearing}
                            style={{
                                flex: 1, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 6,
                                color: MUTED, fontFamily: "inherit", fontSize: 12,
                                padding: "7px 10px", cursor: "pointer",
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            <div style={{ overflowY: "auto", padding: "4px 8px", flex: "1 1 0", minHeight: 0, maxHeight: "calc(100vh - 220px)" }}>
                {history.length === 0 && (
                    <p style={{ fontSize: 14, color: MUTED, padding: "8px 8px", lineHeight: 1.5 }}>
                        Your research sessions will appear here.
                    </p>
                )}
                {history.map(item => (
                    <div
                        key={item.id}
                        onMouseEnter={() => setHoveredId(item.id)}
                        onMouseLeave={() => setHoveredId(prev => (prev === item.id ? null : prev))}
                        style={{ position: "relative", display: "flex", alignItems: "stretch" }}
                    >
                        <button onClick={() => { onSelect(item.id); if (isMobile && onClose) onClose() }} style={{
                            flex: 1, minWidth: 0, background: item.id === activeId ? "rgba(201,168,76,0.08)" : "transparent",
                            border: "none", borderRadius: 6, padding: "8px 10px",
                            cursor: "pointer", textAlign: "left", display: "block",
                            color: item.id === activeId ? TEXT : MUTED,
                            fontSize: 12, fontFamily: "inherit",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            lineHeight: 1.4,
                        }}>
                            {item.title}
                        </button>
                        {(hoveredId === item.id || isMobile) && (
                            <button
                                onClick={(e) => handleDeleteOne(e, item.id)}
                                disabled={deletingId === item.id}
                                aria-label="Delete session"
                                title="Delete session"
                                style={{
                                    flexShrink: 0, background: "transparent", border: "none",
                                    color: MUTED, fontFamily: "inherit", fontSize: 13,
                                    width: 26, padding: 0, cursor: deletingId === item.id ? "not-allowed" : "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    borderRadius: 6, opacity: deletingId === item.id ? 0.5 : 1,
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = "#c0392b"}
                                onMouseLeave={e => e.currentTarget.style.color = MUTED}
                            >
                                {deletingId === item.id ? "…" : "✕"}
                            </button>
                        )}
                    </div>
                ))}
            </div>


        </aside>
        </>
    )
}

function InstallBanner({ triggerShow = false, onDismiss }) {
    const [show, setShow] = useState(false)
    const [showIOSInstructions, setShowIOSInstructions] = useState(false)
    const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
    const isAndroid = /android/i.test(navigator.userAgent)

    // Show when parent triggers (after sign-in or Install App button)
    useEffect(() => {
        if (!triggerShow) return
        if (window.matchMedia("(display-mode: standalone)").matches) return
        setShow(true)
    }, [triggerShow])

    if (!show) return null

    async function install() {
        if (_installPrompt) {
            // Android/Chrome — fire the native "Add to Home Screen" dialog
            try {
                _installPrompt.prompt()
                const result = await _installPrompt.userChoice
                _installPrompt = null // can only be used once
                if (result.outcome === "accepted") {
                    setShow(false)
                    onDismiss && onDismiss()
                }
                // if dismissed, leave banner so they can try again
            } catch(e) {
                // Already used — show Android manual instructions
                setShowIOSInstructions(true)
            }
        } else {
            // iOS Safari or Android Chrome that missed the prompt — show manual steps
            setShowIOSInstructions(true)
        }
    }

    const androidSteps = (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            <p style={{ color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: GOLD, fontWeight: 700 }}>1.</span> Tap the <strong>⋮ menu</strong> (three dots) in the top-right of Chrome
            </p>
            <p style={{ color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: GOLD, fontWeight: 700 }}>2.</span> Tap <strong>"Add to Home screen"</strong>
            </p>
            <p style={{ color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: GOLD, fontWeight: 700 }}>3.</span> Tap <strong>Add</strong> to confirm
            </p>
        </div>
    )

    const iosSteps = (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            <p style={{ color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: GOLD, fontWeight: 700 }}>1.</span> Tap the <strong>Share</strong> button (box with arrow) at the bottom of Safari
            </p>
            <p style={{ color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: GOLD, fontWeight: 700 }}>2.</span> Scroll down and tap <strong>"Add to Home Screen"</strong>
            </p>
            <p style={{ color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: GOLD, fontWeight: 700 }}>3.</span> Tap <strong>Add</strong> in the top-right corner
            </p>
        </div>
    )

    return (
        <>
            <div style={{
                position: "fixed", bottom: 80, left: 16, right: 16,
                background: "#1a1a1a", border: `1px solid ${GOLD}44`,
                borderRadius: 14, padding: "14px 16px",
                display: "flex", alignItems: "center", gap: 12,
                zIndex: 200, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
            }}>
                <span style={{ fontSize: 24 }}>📲</span>
                <div style={{ flex: 1 }}>
                    <p style={{ color: TEXT, fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                        Get the JabrilAI App
                    </p>
                    <p style={{ color: MUTED, fontSize: 11, lineHeight: 1.4 }}>
                        Add to your home screen for the full app experience
                    </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    <button
                        onClick={install}
                        style={{
                            background: GOLD, border: "none", borderRadius: 8,
                            color: "#0f0f0f", fontFamily: "inherit",
                            fontSize: 12, fontWeight: 600,
                            padding: "7px 14px", cursor: "pointer",
                            whiteSpace: "nowrap",
                        }}
                    >
                        Install
                    </button>
                    <button
                        onClick={() => { setShow(false); onDismiss && onDismiss() }}
                        style={{
                            background: "none", border: "none",
                            color: MUTED, fontFamily: "inherit",
                            fontSize: 11, cursor: "pointer", padding: 0,
                        }}
                    >
                        Not now
                    </button>
                </div>
            </div>

            {/* Manual install instructions — Android or iOS */}
            {showIOSInstructions && (
                <div style={{
                    position: "fixed", bottom: 200, left: 16, right: 16,
                    background: "#1e1e1e", border: `1px solid ${GOLD}66`,
                    borderRadius: 16, padding: "20px",
                    zIndex: 201, boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
                }}>
                    <p style={{ color: GOLD, fontSize: 14, fontWeight: 700, marginBottom: 14, letterSpacing: "0.04em" }}>
                        Add to Home Screen
                    </p>
                    {isAndroid ? androidSteps : iosSteps}
                    <button
                        onClick={() => { setShowIOSInstructions(false); setShow(false); onDismiss && onDismiss() }}
                        style={{
                            width: "100%", background: GOLD, border: "none",
                            borderRadius: 10, color: "#0f0f0f",
                            fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                            padding: "11px", cursor: "pointer",
                        }}
                    >
                        Got it ✓
                    </button>
                </div>
            )}
        </>
    )
}

function WelcomeScreen({ onChipClick, isMobile }) {
    return (
        <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: isMobile ? "24px 20px 140px" : "40px 32px 160px",
            textAlign: "center", overflowY: "auto",
        }}>
            {isMobile && (
                <div style={{ marginBottom: 20 }}>
                    <img src={logo} alt="Jabril AI" style={{ width: 144, height: "auto" }} />
                </div>
            )}
            <p style={{ color: GOLD, fontSize: 28, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 12 }}>
                Jabril AI
            </p>
            <p style={{ color: TEXT, fontSize: 16, maxWidth: 380, lineHeight: 1.75, marginBottom: isMobile ? 32 : 52 }}>
                A curated repository of knowledge from Black scholars, authors, and practitioners preserved in the Black Civilization Research Archive.
            </p>
            <h1 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontStyle: "italic", fontWeight: 300,
                fontSize: isMobile ? "36px" : "clamp(36px, 4.5vw, 56px)",
                color: TEXT, lineHeight: 1.15,
                marginBottom: isMobile ? 32 : 52, maxWidth: 560,
            }}>
                Peace researcher!<br />How may I help you today?
            </h1>
            <RotatingQuestion onAsk={onChipClick} />
        </div>
    )
}

// ─── Translation Infrastructure ──────────────────────────────────────────────

const FAVORITE_LANGUAGES = ["English", "Spanish", "French", "Swahili", "Medu Neter"]

const MORE_LANGUAGES = [
    "Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Azerbaijani",
    "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Catalan",
    "Cebuano", "Chinese (Simplified)", "Chinese (Traditional)", "Corsican",
    "Croatian", "Czech", "Danish", "Dutch", "Esperanto", "Estonian",
    "Finnish", "Frisian", "Galician", "Georgian", "German", "Greek",
    "Gujarati", "Haitian Creole", "Hausa", "Hawaiian", "Hebrew", "Hindi",
    "Hmong", "Hungarian", "Icelandic", "Igbo", "Indonesian", "Irish",
    "Italian", "Japanese", "Javanese", "Kannada", "Kazakh", "Khmer",
    "Kinyarwanda", "Korean", "Kurdish", "Kyrgyz", "Lao", "Latin", "Latvian",
    "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy", "Malay",
    "Malayalam", "Maltese", "Maori", "Marathi", "Mongolian", "Myanmar",
    "Nepali", "Norwegian", "Nyanja", "Odia", "Pashto", "Persian", "Polish",
    "Portuguese", "Punjabi", "Romanian", "Russian", "Samoan", "Scots Gaelic",
    "Serbian", "Sesotho", "Shona", "Sindhi", "Sinhala", "Slovak", "Slovenian",
    "Somali", "Sundanese", "Tagalog", "Tajik", "Tamil", "Tatar", "Telugu",
    "Thai", "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uyghur", "Uzbek",
    "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu",
].filter(l => !FAVORITE_LANGUAGES.includes(l))

// BCRA citation pattern — these must NEVER be translated
const BCRA_PATTERN = /(\[BCRA\s*•[^\]]+\](?:[ \t]*—[ \t]*[^\n]+)?)/g

// Split text into translatable segments and protected citations
function segmentText(text) {
    const parts = []
    let last = 0
    let match
    BCRA_PATTERN.lastIndex = 0
    while ((match = BCRA_PATTERN.exec(text)) !== null) {
        if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) })
        parts.push({ type: "citation", value: match[0] })
        last = match.index + match[0].length
    }
    if (last < text.length) parts.push({ type: "text", value: text.slice(last) })
    return parts
}

// Keep BCRA citations readable after translation. Some models preserve the
// citation text but accidentally remove the spaces/newlines around it.
function normalizeCitationSpacing(text) {
    return String(text || "")
        // word.[BCRA • Source] -> word. [BCRA • Source]
        .replace(/([^\s(\[])(\[BCRA\s*•[^\]]+\])/g, "$1 $2")
        // [BCRA • One][BCRA • Two] -> each on its own line
        .replace(/(\[BCRA\s*•[^\]]+\])(\[BCRA\s*•[^\]]+\])/g, "$1\n$2")
        // [BCRA • Source]Next heading/text -> [BCRA • Source] + blank line + Next heading/text
        .replace(/(\[BCRA\s*•[^\]]+\])([^\s\]\).,;:!?])/g, "$1\n\n$2")
        // Clean up excessive spaces before citations but keep a single readable gap.
        .replace(/[ \t]{2,}(\[BCRA\s*•[^\]]+\])/g, " $1")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

// Translate a single text block through our secure Vercel API route.
// IMPORTANT: Never call OpenAI directly from the browser or expose an API key here.
async function translateBlock(text, targetLanguage) {
    if (!text.trim()) return text

    const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetLanguage }),
    })

    let data = null
    try {
        data = await res.json()
    } catch (_) {}

    if (!res.ok) {
        throw new Error(data?.error || `Translation API error: ${res.status}`)
    }

    return data?.translation?.trim() || text
}

// Translate full message text. The secure API route preserves BCRA citations,
// and normalizeCitationSpacing fixes model spacing issues around citations.
async function translateMessage(originalText, targetLanguage) {
    const translated = await translateBlock(originalText, targetLanguage)
    return normalizeCitationSpacing(translated)
}

// ─── Language Picker Dropdown ─────────────────────────────────────────────────
function LanguagePicker({ onSelect, onClose, isMobile }) {
    const [showMore, setShowMore]   = useState(false)
    const [search, setSearch]       = useState("")
    const ref                       = useRef(null)

    useEffect(() => {
        function handleClickOutside(e) {
            if (ref.current && !ref.current.contains(e.target)) onClose()
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [onClose])

    const filtered = MORE_LANGUAGES.filter(l =>
        l.toLowerCase().includes(search.toLowerCase())
    )

    const btnStyle = (hover) => ({
        width: "100%", background: "transparent", border: "none",
        color: TEXT, fontFamily: "inherit", fontSize: 13,
        padding: "9px 14px", cursor: "pointer", textAlign: "left",
        borderRadius: 6, transition: "background 0.15s, color 0.15s",
    })

    return (
        <div ref={ref} style={{
            position: isMobile ? "fixed" : "absolute",
            bottom: isMobile ? 92 : "auto",
            left: isMobile ? 16 : "auto",
            right: isMobile ? 16 : 0,
            top: isMobile ? "auto" : "calc(100% + 6px)",
            zIndex: 300,
            background: "#1c1c1c", border: `1px solid ${GOLD}44`,
            borderRadius: 10, minWidth: isMobile ? "auto" : 200,
            maxWidth: isMobile ? "calc(100vw - 32px)" : 280,
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
            overflow: "hidden",
        }}>
            <div style={{ padding: "8px 10px 4px", borderBottom: `1px solid ${BORDER}` }}>
                <p style={{ fontSize: 10, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 4px 6px" }}>
                    Translate to
                </p>
                {FAVORITE_LANGUAGES.map(lang => (
                    <button key={lang}
                        onClick={() => onSelect(lang)}
                        style={btnStyle()}
                        onMouseEnter={e => { e.currentTarget.style.background = `${GOLD}18`; e.currentTarget.style.color = GOLD }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT }}
                    >
                        {lang}
                    </button>
                ))}
            </div>
            {!showMore ? (
                <div style={{ padding: "6px 10px 8px" }}>
                    <button
                        onClick={() => setShowMore(true)}
                        style={{ ...btnStyle(), color: MUTED, fontSize: 12 }}
                        onMouseEnter={e => { e.currentTarget.style.color = GOLD }}
                        onMouseLeave={e => { e.currentTarget.style.color = MUTED }}
                    >
                        More Languages…
                    </button>
                </div>
            ) : (
                <div style={{ padding: "8px 10px" }}>
                    <input
                        autoFocus
                        placeholder="Search languages…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{
                            width: "100%", background: "#111", border: `1px solid ${BORDER}`,
                            borderRadius: 6, color: TEXT, fontFamily: "inherit",
                            fontSize: 12, padding: "7px 10px", outline: "none",
                            boxSizing: "border-box", marginBottom: 6,
                        }}
                        onFocus={e => e.target.style.borderColor = GOLD}
                        onBlur={e => e.target.style.borderColor = BORDER}
                    />
                    <div style={{ maxHeight: isMobile ? 300 : 220, overflowY: "auto" }}>
                        {filtered.length === 0
                            ? <p style={{ color: MUTED, fontSize: 12, padding: "6px 4px" }}>No results</p>
                            : filtered.map(lang => (
                                <button key={lang}
                                    onClick={() => onSelect(lang)}
                                    style={btnStyle()}
                                    onMouseEnter={e => { e.currentTarget.style.background = `${GOLD}18`; e.currentTarget.style.color = GOLD }}
                                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT }}
                                >
                                    {lang}
                                </button>
                            ))
                        }
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Rendered Message Text ─────────────────────────────────────────────────────
function MessageText({ text, role }) {
    function renderLineWithCitations(line) {
        const parts = []
        let last = 0
        let match

        // Combined pattern: markdown links [text](url) OR BCRA citations
        const COMBINED = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\[BCRA\s*•[^\]]+\]/g
        COMBINED.lastIndex = 0

        while ((match = COMBINED.exec(line)) !== null) {
            if (match.index > last) {
                parts.push({ type: "text", value: line.slice(last, match.index) })
            }
            if (match[1] && match[2]) {
                // Markdown link [text](url)
                parts.push({ type: "link", label: match[1], url: match[2] })
            } else {
                // BCRA citation
                parts.push({ type: "citation", value: match[0] })
            }
            last = match.index + match[0].length
        }

        if (last < line.length) {
            parts.push({ type: "text", value: line.slice(last) })
        }

        if (parts.length === 0) return line

        return parts.map((part, idx) => {
            if (part.type === "link") return (
                <a key={idx} href={part.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: GOLD, textDecoration: "underline", cursor: "pointer" }}>
                    {part.label}
                </a>
            )
            if (part.type === "citation") return (
                <span
                    key={idx}
                    style={{
                        color: GOLD,
                        fontWeight: 500,
                        fontSize: "0.85em",
                        opacity: 0.9,
                        whiteSpace: "normal",
                        letterSpacing: "0.01em",
                        display: "block",
                        marginTop: "4px",
                    }}
                >
                    {part.value}
                </span>
            )
            return <span key={idx}>{part.value}</span>
        })
    }

    const lines = normalizeCitationSpacing(text).split("\n")
    const blocks = []
    const tableCells = line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim())
    const isTableDivider = line => {
        const cells = tableCells(line)
        return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
    }

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (/^\s*\|.*\|\s*$/.test(line) && isTableDivider(lines[index + 1] || "")) {
            const headers = tableCells(line)
            const rows = []
            index += 2
            while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
                rows.push(tableCells(lines[index]))
                index += 1
            }
            index -= 1
            blocks.push({ type: "table", headers, rows })
        } else {
            blocks.push({ type: "line", value: line })
        }
    }

    return (
        <div style={{ fontSize: 17, lineHeight: 1.9, color: role === "loading" ? GOLD : TEXT, fontFamily: "inherit", opacity: role === "loading" ? 0.85 : 1 }}>
            {blocks.map((block, i) => {
                if (block.type === "table") return (
                    <div key={`table-${i}`} style={{ overflowX: "auto", margin: "16px 0 20px", border: `1px solid ${BORDER}`, borderRadius: 10 }}>
                        <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 14, lineHeight: 1.55 }}>
                            <thead>
                                <tr>
                                    {block.headers.map((header, column) => (
                                        <th key={column} scope="col" style={{
                                            padding: "11px 13px", textAlign: "left", color: GOLD,
                                            background: `${GOLD}10`, borderBottom: `1px solid ${GOLD}44`,
                                            fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
                                        }}>
                                            {renderLineWithCitations(header)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {block.rows.map((row, rowIndex) => (
                                    <tr key={rowIndex}>
                                        {block.headers.map((_, column) => (
                                            <td key={column} style={{
                                                padding: "10px 13px", verticalAlign: "top",
                                                borderBottom: rowIndex === block.rows.length - 1 ? "none" : `1px solid ${BORDER}`,
                                                color: TEXT,
                                            }}>
                                                {renderLineWithCitations(row[column] || "")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )

                const line = block.value
                if (line.trim() === "") return null
                const isHeader = role === "ai" &&
                    !line.trim().startsWith("*") &&
                    !line.trim().startsWith("•") &&
                    !line.trim().startsWith("-") &&
                    line.trim().length < 60 &&
                    !line.trim().endsWith(".") &&
                    !line.trim().endsWith(",")
                return (
                    <p key={i} style={{
                        marginBottom: isHeader ? 8 : line.startsWith("•") ? 10 : 6,
                        marginTop: isHeader ? 16 : 0,
                        paddingLeft: line.startsWith("•") ? 12 : 0,
                        fontSize: isHeader ? 19 : 17,
                        fontWeight: isHeader ? 600 : "inherit",
                        color: isHeader ? GOLD : "inherit",
                    }}>
                        {renderLineWithCitations(line)}
                    </p>
                )
            })}
        </div>
    )
}


// ─── Creator Podcast Studio ───────────────────────────────────────────────────
function getBcraSources(text = "") {
    const sources = []
    const seen = new Set()
    const pattern = /\[BCRA\s*•\s*([^\]]+)\]/g
    let match
    while ((match = pattern.exec(text))) {
        const source = match[1].trim()
        if (source && !seen.has(source)) {
            seen.add(source)
            sources.push(source)
        }
    }
    return sources
}

function isPodcastEligibleMessage(msg) {
    return msg?.role === "ai" && !/^(e-|empty$|err$)/.test(String(msg.id))
}

function PodcastComposer({ target, onClose, onCreate, isMobile, creating }) {
    const [duration, setDuration] = useState(5)
    const [title, setTitle] = useState("")

    useEffect(() => {
        setDuration(5)
        setTitle(target?.question ? target.question.slice(0, 120) : "")
    }, [target?.message?.id, target?.question])

    if (!target) return null

    const sourceCount = getBcraSources(target.message.text).length
    const submit = () => {
        if (!title.trim() || creating) return
        onCreate({
            message: target.message,
            question: target.question,
            title: title.trim(),
            durationMinutes: duration,
        })
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="podcast-title"
            style={{
                position: "fixed", inset: 0, zIndex: 150,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 20, background: "rgba(0,0,0,0.82)",
                backdropFilter: "blur(4px)"
            }}
            onMouseDown={e => { if (e.target === e.currentTarget && !creating) onClose() }}
        >
            <section style={{
                width: "100%", maxWidth: 520, background: PANEL,
                border: `1px solid ${GOLD}55`, borderRadius: 16,
                padding: isMobile ? "28px 22px" : "34px 32px",
                boxShadow: "0 20px 56px rgba(0,0,0,0.55)"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
                    <div>
                        <div style={{ color: GOLD, fontSize: 11, letterSpacing: "0.13em", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
                            Creator studio
                        </div>
                        <h2 id="podcast-title" style={{
                            margin: 0, color: TEXT, fontFamily: "'Cormorant Garamond', serif",
                            fontSize: 30, fontWeight: 500
                        }}>
                            Create audio overview
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={creating}
                        aria-label="Close podcast creator"
                        style={{ background: "transparent", border: "none", color: MUTED, fontSize: 22, lineHeight: 1, cursor: creating ? "default" : "pointer", padding: 2 }}
                    >×</button>
                </div>

                <p style={{ color: "#aaa49c", fontSize: 14, lineHeight: 1.6, margin: "0 0 22px" }}>
                    Two hosts will discuss this Jabril answer using only its archive-grounded content.
                    Review the original answer and its sources before publishing.
                </p>

                <label style={{ display: "block", color: "#bbb5ad", fontSize: 12, fontWeight: 600, marginBottom: 7 }}>
                    Episode title
                </label>
                <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={120}
                    disabled={creating}
                    placeholder="Give this episode a title"
                    style={{
                        width: "100%", boxSizing: "border-box", padding: "11px 12px",
                        borderRadius: 8, background: BG, border: `1px solid ${BORDER}`,
                        color: TEXT, fontFamily: "inherit", fontSize: 14, outline: "none", marginBottom: 20
                    }}
                />

                <label style={{ display: "block", color: "#bbb5ad", fontSize: 12, fontWeight: 600, marginBottom: 9 }}>
                    Target length
                </label>
                <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                    {[2, 5, 10].map(minutes => (
                        <button
                            key={minutes}
                            onClick={() => setDuration(minutes)}
                            disabled={creating}
                            style={{
                                background: duration === minutes ? `${GOLD}20` : "transparent",
                                border: `1px solid ${duration === minutes ? GOLD : BORDER}`,
                                borderRadius: 7, color: duration === minutes ? GOLD : MUTED,
                                fontFamily: "inherit", fontSize: 13, padding: "8px 13px",
                                cursor: creating ? "default" : "pointer"
                            }}
                        >{minutes} min</button>
                    ))}
                </div>

                <div style={{
                    display: "flex", justifyContent: "space-between", gap: 12,
                    color: MUTED, fontSize: 12, lineHeight: 1.45, marginBottom: 24,
                    padding: "10px 12px", background: "#0f0f0f", borderRadius: 8,
                    border: `1px solid ${BORDER}`
                }}>
                    <span>
                        {sourceCount
                            ? `${sourceCount} archive source${sourceCount === 1 ? "" : "s"} will guide the script.`
                            : "No BCRA citations were found; review this answer before publishing."}
                    </span>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button
                        onClick={onClose}
                        disabled={creating}
                        style={{ background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "10px 14px", fontFamily: "inherit", cursor: creating ? "default" : "pointer" }}
                    >Cancel</button>
                    <button
                        onClick={submit}
                        disabled={creating || !title.trim()}
                        style={{
                            background: creating || !title.trim() ? `${GOLD}66` : GOLD,
                            border: `1px solid ${GOLD}`, color: BG, borderRadius: 7,
                            padding: "10px 15px", fontFamily: "inherit", fontWeight: 700,
                            cursor: creating || !title.trim() ? "default" : "pointer"
                        }}
                    >
                        {creating ? "Generating…" : "Generate podcast"}
                    </button>
                </div>
            </section>
        </div>
    )
}

function PodcastPlayer({ episode, onClose }) {
    if (!episode) return null
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="podcast-player-title"
            style={{
                position: "fixed", inset: 0, zIndex: 160,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 20, background: "rgba(0,0,0,0.82)",
                backdropFilter: "blur(4px)"
            }}
            onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <section style={{
                width: "100%", maxWidth: 520, background: PANEL,
                border: `1px solid ${GOLD}55`, borderRadius: 16,
                padding: 28, boxShadow: "0 20px 56px rgba(0,0,0,0.55)"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
                    <div>
                        <div style={{ color: GOLD, fontSize: 11, letterSpacing: "0.13em", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                            Podcast preview
                        </div>
                        <h2 id="podcast-player-title" style={{ margin: 0, color: TEXT, fontSize: 22, fontWeight: 600 }}>
                            {episode.title}
                        </h2>
                    </div>
                    <button onClick={onClose} aria-label="Close podcast preview" style={{ background: "transparent", border: "none", color: MUTED, fontSize: 22, cursor: "pointer" }}>×</button>
                </div>
                <audio controls autoPlay src={episode.url} style={{ width: "100%" }} />
                <p style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, margin: "14px 0 0" }}>
                    This is a browser preview. The audio is generated from the selected Jabril answer and is not yet added to the public podcast library.
                </p>
            </section>
        </div>
    )
}

// ─── Research / thinking state ───────────────────────────────────────────────
// n8n returns one completed webhook response rather than streaming node events,
// so these stages are intentionally framed as progress narration—not live
// workflow telemetry. Timers are cleaned up when the response arrives.
const ARCHIVE_THINKING_STAGES = [
    {
        title: "Searching the archive",
        detail: "Scanning the Black Civilization Research Archive for relevant passages.",
    },
    {
        title: "Reviewing sources",
        detail: "Checking the strongest passages, titles, and authors for relevance.",
    },
    {
        title: "Connecting evidence",
        detail: "Bringing the most useful archive findings into a coherent response.",
    },
    {
        title: "Preparing the answer",
        detail: "Shaping a clear, source-grounded answer with its citations intact.",
    },
]

const WEB_THINKING_STAGES = [
    {
        title: "Searching the web",
        detail: "Looking across current sources for information relevant to your question.",
    },
    {
        title: "Reviewing sources",
        detail: "Checking the most useful results for relevance and credibility.",
    },
    {
        title: "Connecting evidence",
        detail: "Comparing findings and bringing the strongest details together.",
    },
    {
        title: "Preparing the answer",
        detail: "Organizing the research into a clear response with useful links.",
    },
]

const DOCUMENT_THINKING_STAGES = [
    {
        title: "Reading your document",
        detail: "Preparing the uploaded material as private working context for this request.",
    },
    {
        title: "Searching the web",
        detail: "Finding current, credible sources that can strengthen the document without changing its facts.",
    },
    {
        title: "Connecting evidence",
        detail: "Aligning the most relevant web findings with the document's purpose and structure.",
    },
    {
        title: "Preparing the enhanced document",
        detail: "Formatting the complete revision and preserving useful web citations.",
    },
]

function ThinkingState({ mode = "archive", isMobile = false }) {
    const stages = mode === "document"
        ? DOCUMENT_THINKING_STAGES
        : mode === "web" ? WEB_THINKING_STAGES : ARCHIVE_THINKING_STAGES
    const [stageIndex, setStageIndex] = useState(0)
    const [longWait, setLongWait] = useState(false)

    useEffect(() => {
        setStageIndex(0)
        setLongWait(false)

        const stageTimers = [4500, 10000, 17000].map((delay, index) =>
            setTimeout(() => setStageIndex(index + 1), delay)
        )
        const longWaitTimer = setTimeout(() => setLongWait(true), 30000)

        return () => {
            stageTimers.forEach(clearTimeout)
            clearTimeout(longWaitTimer)
        }
    }, [mode])

    const currentStage = stages[stageIndex]
    const eyebrow = mode === "document"
        ? "Document studio"
        : mode === "web" ? "Web research" : "Archive research"

    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-busy="true"
            style={{
                position: "relative",
                overflow: "hidden",
                border: `1px solid ${GOLD}42`,
                borderRadius: 16,
                background: `linear-gradient(135deg, ${GOLD}0D 0%, rgba(22,22,22,0.96) 46%, rgba(12,12,12,0.98) 100%)`,
                boxShadow: `inset 0 1px 0 ${GOLD}12, 0 18px 50px rgba(0,0,0,0.22)`,
                padding: isMobile ? "22px 18px" : "26px 28px",
            }}
        >
            <div className="jai-thinking-sheen" aria-hidden="true" />

            <div style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                alignItems: isMobile ? "flex-start" : "center",
                gap: isMobile ? 18 : 24,
            }}>
                <div className="jai-thinking-beacon" aria-hidden="true">
                    <span className="jai-thinking-orbit jai-thinking-orbit-one"><i /></span>
                    <span className="jai-thinking-orbit jai-thinking-orbit-two"><i /></span>
                    <span className="jai-thinking-core">✦</span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        color: GOLD,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        marginBottom: 9,
                    }}>
                        {eyebrow}
                    </div>

                    <div key={`${mode}-${stageIndex}`} className="jai-thinking-copy">
                        <div style={{
                            color: TEXT,
                            fontFamily: "Georgia, 'Times New Roman', serif",
                            fontSize: isMobile ? 21 : 23,
                            fontStyle: "italic",
                            lineHeight: 1.25,
                            marginBottom: 7,
                        }}>
                            {currentStage.title}<span className="jai-thinking-ellipsis" aria-hidden="true" />
                        </div>
                        <p style={{
                            color: "#9a9590",
                            fontSize: isMobile ? 13 : 14,
                            lineHeight: 1.6,
                            margin: 0,
                            maxWidth: 520,
                        }}>
                            {currentStage.detail}
                        </p>
                    </div>

                    <div
                        aria-hidden="true"
                        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}
                    >
                        {stages.map((stage, index) => (
                            <span
                                key={stage.title}
                                style={{
                                    width: index === stageIndex ? 28 : 8,
                                    height: 3,
                                    borderRadius: 999,
                                    background: index <= stageIndex ? GOLD : BORDER,
                                    opacity: index < stageIndex ? 0.55 : 1,
                                    transition: "width 0.45s ease, background 0.45s ease, opacity 0.45s ease",
                                }}
                            />
                        ))}
                    </div>

                    {longWait && (
                        <p className="jai-thinking-long-wait" style={{
                            color: "#7f7a73",
                            fontSize: 11,
                            lineHeight: 1.5,
                            margin: "14px 0 0",
                        }}>
                            Still working—deeper research can take a little longer.
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

function ExportMenu({ answer, question, onClose, isMobile }) {
    const optionStyle = {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        background: "transparent",
        border: "none",
        color: TEXT,
        padding: "10px 12px",
        fontFamily: "inherit",
        fontSize: 12,
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 7,
    }

    function run(format) {
        if (format === "pdf") exportAnswerAsPDF(answer, question)
        if (format === "word") exportAnswerAsWord(answer, question)
        if (format === "excel") exportAnswerAsExcel(answer, question)
        onClose()
    }

    return (
        <div style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 90,
            width: isMobile ? 210 : 200,
            padding: 6,
            background: "#1b1b1b",
            border: `1px solid ${GOLD}55`,
            borderRadius: 10,
            boxShadow: "0 14px 36px rgba(0,0,0,0.55)",
        }}>
            <button onClick={() => run("pdf")} style={optionStyle} onMouseEnter={e => e.currentTarget.style.background = `${GOLD}18`} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span>PDF</span><span style={{ color: MUTED }}>Print / save</span>
            </button>
            <button onClick={() => run("word")} style={optionStyle} onMouseEnter={e => e.currentTarget.style.background = `${GOLD}18`} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span>Word</span><span style={{ color: MUTED }}>.doc</span>
            </button>
            <button onClick={() => run("excel")} style={optionStyle} onMouseEnter={e => e.currentTarget.style.background = `${GOLD}18`} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span>Excel</span><span style={{ color: MUTED }}>.xls</span>
            </button>
        </div>
    )
}

// ─── Chat Area ────────────────────────────────────────────────────────────────
function ChatArea({ messages, messagesEndRef, latestMsgRef, isMobile, send, loading, onCreatePodcast }) {
    const [copied, setCopied]           = useState({})
    // diveDeeperUsed: { [msgId]: true } once Dive Deeper has been clicked for that message
    const [diveDeeperUsed, setDiveDeeperUsed] = useState({})
    // translationCache: { [msgId]: { [language]: translatedText } }
    const [translationCache, setCache]  = useState({})
    // activeTab: { [msgId]: "original" | languageName }
    const [activeTab, setActiveTab]     = useState({})
    // translating: { [msgId]: true } while in-flight
    const [translating, setTranslating] = useState({})
    // translateError: { [msgId]: errorString }
    const [translateError, setTranslateError] = useState({})
    // showPicker: msgId | null
    const [showPicker, setShowPicker]   = useState(null)
    const [showExport, setShowExport]   = useState(null)

    function handleShare(msg, index) {
        const question = messages[index - 1]?.text || ""
        shareMessage(question, msg.text)
        setCopied(prev => ({ ...prev, [msg.id]: true }))
        setTimeout(() => setCopied(prev => ({ ...prev, [msg.id]: false })), 2000)
    }

    async function handleTranslate(msg, language) {
        setShowPicker(null)

        // If switching back to original, just set tab
        if (language === "Original" || language === "English") {
            // Check if original language was English — if so "English" IS original
            setActiveTab(prev => ({ ...prev, [msg.id]: language === "Original" ? "original" : language }))
            // If English translation already cached or it IS original, handle accordingly
            if (language === "Original") return
        }

        // Already cached — just switch tab
        if (translationCache[msg.id]?.[language]) {
            setActiveTab(prev => ({ ...prev, [msg.id]: language }))
            return
        }

        // Kick off translation
        setTranslating(prev => ({ ...prev, [msg.id]: true }))
        setTranslateError(prev => ({ ...prev, [msg.id]: null }))
        setActiveTab(prev => ({ ...prev, [msg.id]: language }))

        try {
            const translated = await translateMessage(msg.text, language)
            setCache(prev => ({
                ...prev,
                [msg.id]: { ...(prev[msg.id] || {}), [language]: translated }
            }))
        } catch(e) {
            console.error("Translation error:", e)
            setTranslateError(prev => ({ ...prev, [msg.id]: "Translation failed. Please try again." }))
            setActiveTab(prev => ({ ...prev, [msg.id]: "original" }))
        } finally {
            setTranslating(prev => ({ ...prev, [msg.id]: false }))
        }
    }

    function getDisplayText(msg) {
        const tab = activeTab[msg.id]
        if (!tab || tab === "original") return msg.text
        return translationCache[msg.id]?.[tab] ?? msg.text
    }

    function getCurrentTab(msgId) {
        return activeTab[msgId] || "original"
    }

    const actionBtnStyle = (active) => ({
        background: "transparent",
        border: `1px solid ${active ? GOLD : BORDER}`,
        borderRadius: 6,
        color: active ? GOLD : MUTED,
        fontSize: 11,
        padding: "4px 10px",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "border-color 0.15s, color 0.15s",
    })

    const mobileActionBtnStyle = (active) => ({
        background: "transparent",
        border: `1px solid ${active ? GOLD : BORDER}`,
        borderRadius: 6,
        color: active ? GOLD : "#9a9590",
        fontSize: 13,
        fontWeight: 500,
        padding: "6px 16px",
        cursor: "pointer",
        fontFamily: "inherit",
    })

    return (
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "20px 16px 270px" : "32px 40px 180px" }}>
            <style>{`
                @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
                @keyframes jaiThinkingOrbit { to { transform: rotate(360deg) } }
                @keyframes jaiThinkingOrbitReverse { to { transform: rotate(-360deg) } }
                @keyframes jaiThinkingPulse {
                    0%, 100% { transform: scale(0.94); box-shadow: 0 0 0 0 rgba(201,168,76,0.18); }
                    50% { transform: scale(1); box-shadow: 0 0 0 10px rgba(201,168,76,0); }
                }
                @keyframes jaiThinkingSheen {
                    0% { transform: translateX(-130%) skewX(-14deg); }
                    55%, 100% { transform: translateX(260%) skewX(-14deg); }
                }
                @keyframes jaiThinkingCopyIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes jaiThinkingEllipsis {
                    0%, 100% { opacity: 0.25; }
                    50% { opacity: 1; }
                }
                .jai-thinking-sheen {
                    position: absolute; inset: 0 auto 0 0; width: 34%;
                    background: linear-gradient(90deg, transparent, rgba(201,168,76,0.055), transparent);
                    animation: jaiThinkingSheen 5.2s ease-in-out infinite;
                    pointer-events: none;
                }
                .jai-thinking-beacon {
                    position: relative; width: 72px; height: 72px; flex: 0 0 72px;
                    display: grid; place-items: center;
                }
                .jai-thinking-core {
                    position: relative; z-index: 2; width: 34px; height: 34px;
                    display: grid; place-items: center; border-radius: 50%;
                    color: #0f0f0f; background: ${GOLD}; font-size: 16px;
                    animation: jaiThinkingPulse 2.4s ease-in-out infinite;
                }
                .jai-thinking-orbit {
                    position: absolute; inset: 5px; border: 1px solid rgba(201,168,76,0.25);
                    border-radius: 50%; animation: jaiThinkingOrbit 3.8s linear infinite;
                }
                .jai-thinking-orbit-two {
                    inset: 14px; border-color: rgba(201,168,76,0.16);
                    animation: jaiThinkingOrbitReverse 2.8s linear infinite;
                }
                .jai-thinking-orbit i {
                    position: absolute; left: 50%; top: -3px; width: 6px; height: 6px;
                    margin-left: -3px; border-radius: 50%; background: ${GOLD};
                    box-shadow: 0 0 10px rgba(201,168,76,0.7);
                }
                .jai-thinking-orbit-two i { width: 4px; height: 4px; top: -2px; margin-left: -2px; opacity: 0.65; }
                .jai-thinking-copy { animation: jaiThinkingCopyIn 0.4s ease both; }
                .jai-thinking-ellipsis::after { content: "..."; animation: jaiThinkingEllipsis 1.4s steps(1, end) infinite; }
                .jai-thinking-long-wait { animation: jaiThinkingCopyIn 0.4s ease both; }
                @media (prefers-reduced-motion: reduce) {
                    .jai-thinking-sheen, .jai-thinking-core, .jai-thinking-orbit,
                    .jai-thinking-copy, .jai-thinking-ellipsis::after, .jai-thinking-long-wait {
                        animation: none !important;
                    }
                }
            `}</style>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
                {messages.map((msg, index) => {
                    const tab        = getCurrentTab(msg.id)
                    const isOriginal = tab === "original"
                    const isLoading  = translating[msg.id]
                    const hasTranslation = tab !== "original" && translationCache[msg.id]?.[tab]
                    const displayText = getDisplayText(msg)
                    const error = translateError[msg.id]

                    return (
                        <div key={msg.id}
                            ref={index === messages.length - 1 ? latestMsgRef : null}
                            style={{ padding: "20px 0", borderBottom: `1px solid ${BORDER}` }}>

                            {/* ── Header row ── */}
                            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", marginBottom: 10, gap: isMobile ? 8 : 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: msg.role === "user" ? GOLD : MUTED }}>
                                    {msg.role === "user" ? "You" : "Jabril AI"}
                                </div>

                                {/* Desktop action buttons */}
                                {msg.role === "ai" && !isMobile && (
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button
                                            onClick={() => handleShare(msg, index)}
                                            style={actionBtnStyle(copied[msg.id])}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = copied[msg.id] ? GOLD : BORDER; e.currentTarget.style.color = copied[msg.id] ? GOLD : MUTED }}
                                        >
                                            {copied[msg.id] ? "✓ Copied" : "Share"}
                                        </button>
                                        <button
                                            onClick={() => printConversation(messages.slice(0, index + 1))}
                                            style={actionBtnStyle(false)}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
                                        >
                                            Print
                                        </button>
                                        <div style={{ position: "relative" }}>
                                            <button
                                                onClick={() => setShowExport(showExport === msg.id ? null : msg.id)}
                                                style={actionBtnStyle(showExport === msg.id)}
                                                aria-expanded={showExport === msg.id}
                                                aria-haspopup="menu"
                                            >
                                                Export
                                            </button>
                                            {showExport === msg.id && (
                                                <ExportMenu
                                                    answer={msg.text}
                                                    question={messages[index - 1]?.text || ""}
                                                    onClose={() => setShowExport(null)}
                                                    isMobile={false}
                                                />
                                            )}
                                        </div>
                                        {/* Creator-only podcast button */}
                                        {onCreatePodcast && (
                                            <button
                                                onClick={() => {
                                                    const question = messages[index - 1]?.role === "user" ? messages[index - 1].text : ""
                                                    onCreatePodcast({ message: msg, question })
                                                }}
                                                style={actionBtnStyle(false)}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
                                                title="Create a podcast preview from this answer"
                                            >
                                                Podcast
                                            </button>
                                        )}
                                        {/* Translate button + picker */}
                                        <div style={{ position: "relative" }}>
                                            <button
                                                onClick={() => setShowPicker(showPicker === msg.id ? null : msg.id)}
                                                disabled={isLoading}
                                                style={{ ...actionBtnStyle(showPicker === msg.id), opacity: isLoading ? 0.6 : 1 }}
                                                onMouseEnter={e => { if (!isLoading) { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD } }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = showPicker === msg.id ? GOLD : BORDER; e.currentTarget.style.color = showPicker === msg.id ? GOLD : MUTED }}
                                            >
                                                {isLoading ? (
                                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                                        <span style={{ display: "inline-block", width: 10, height: 10, border: `1.5px solid ${GOLD}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                                                        Translating…
                                                    </span>
                                                ) : "Translate"}
                                            </button>
                                            {showPicker === msg.id && (
                                                <LanguagePicker
                                                    onSelect={(lang) => handleTranslate(msg, lang)}
                                                    onClose={() => setShowPicker(null)}
                                                    isMobile={false}
                                                />
                                            )}
                                        </div>
                                        {/* Dive Deeper button */}
                                        {DIVE_DEEPER_ENABLED && index > 0 && messages[index - 1]?.role === "user" && (
                                            <button
                                                onClick={() => {
                                                    if (diveDeeperUsed[msg.id]) return
                                                    setDiveDeeperUsed(prev => ({ ...prev, [msg.id]: true }))
                                                    send(`deepdive: ${messages[index - 1].text.replace(/^(deepdive:\s*)+/i, "")}`)
                                                }}
                                                disabled={loading || diveDeeperUsed[msg.id]}
                                                style={{ ...actionBtnStyle(false), opacity: (loading || diveDeeperUsed[msg.id]) ? 0.4 : 1, cursor: diveDeeperUsed[msg.id] ? "default" : "pointer" }}
                                                onMouseEnter={e => { if (!loading && !diveDeeperUsed[msg.id]) { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD } }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
                                            >
                                                {diveDeeperUsed[msg.id] ? "Dive Deeper ✓" : "Dive Deeper"}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* ── Original | Translation tab toggle ── */}
                            {msg.role === "ai" && (isLoading || hasTranslation) && (
                                <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${BORDER}`, paddingBottom: 12 }}>
                                    <button
                                        onClick={() => setActiveTab(prev => ({ ...prev, [msg.id]: "original" }))}
                                        style={{
                                            background: isOriginal ? `${GOLD}18` : "transparent",
                                            border: `1px solid ${isOriginal ? GOLD : BORDER}`,
                                            borderRadius: 6, color: isOriginal ? GOLD : MUTED,
                                            fontSize: 11, padding: "4px 12px", cursor: "pointer",
                                            fontFamily: "inherit", transition: "all 0.15s",
                                        }}
                                    >
                                        Original
                                    </button>
                                    <button
                                        onClick={() => { if (!isLoading) setActiveTab(prev => ({ ...prev, [msg.id]: tab === "original" ? Object.keys(translationCache[msg.id] || {})[0] : tab })) }}
                                        style={{
                                            background: !isOriginal ? `${GOLD}18` : "transparent",
                                            border: `1px solid ${!isOriginal ? GOLD : BORDER}`,
                                            borderRadius: 6, color: !isOriginal ? GOLD : MUTED,
                                            fontSize: 11, padding: "4px 12px", cursor: isLoading ? "default" : "pointer",
                                            fontFamily: "inherit", transition: "all 0.15s",
                                            opacity: isLoading && isOriginal ? 0.5 : 1,
                                            display: "flex", alignItems: "center", gap: 5,
                                        }}
                                    >
                                        {isLoading && (
                                            <span style={{ display: "inline-block", width: 9, height: 9, border: `1.5px solid ${GOLD}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                                        )}
                                        {tab !== "original" ? tab : (Object.keys(translationCache[msg.id] || {})[0] ?? "Translation")}
                                    </button>
                                </div>
                            )}

                            {/* ── Error state ── */}
                            {error && (
                                <p style={{ color: "#e74c3c", fontSize: 12, marginBottom: 10, padding: "6px 10px", background: "#e74c3c12", borderRadius: 6, border: "1px solid #e74c3c30" }}>
                                    {error}
                                </p>
                            )}

                            {/* ── Message content / research state ── */}
                            {msg.role === "loading"
                                ? <ThinkingState mode={msg.mode} isMobile={isMobile} />
                                : <MessageText text={displayText} role={msg.role} />
                            }

                            {/* ── Mobile action buttons ── */}
                            {msg.role === "ai" && isMobile && (
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, marginBottom: 8, flexWrap: "wrap" }}>
                                    <button
                                        onClick={() => handleShare(msg, index)}
                                        style={mobileActionBtnStyle(copied[msg.id])}
                                    >
                                        {copied[msg.id] ? "✓ Shared" : "Share"}
                                    </button>
                                    <div style={{ position: "relative" }}>
                                        <button
                                            onClick={() => setShowExport(showExport === msg.id ? null : msg.id)}
                                            style={mobileActionBtnStyle(showExport === msg.id)}
                                            aria-expanded={showExport === msg.id}
                                            aria-haspopup="menu"
                                        >
                                            Export
                                        </button>
                                        {showExport === msg.id && (
                                            <ExportMenu
                                                answer={msg.text}
                                                question={messages[index - 1]?.text || ""}
                                                onClose={() => setShowExport(null)}
                                                isMobile={true}
                                            />
                                        )}
                                    </div>
                                    {/* Mobile Translate button + picker */}
                                    <div style={{ position: "relative" }}>
                                        <button
                                            onClick={() => setShowPicker(showPicker === msg.id ? null : msg.id)}
                                            disabled={isLoading}
                                            style={{ ...mobileActionBtnStyle(showPicker === msg.id), opacity: isLoading ? 0.6 : 1 }}
                                        >
                                            {isLoading ? (
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                                    <span style={{ display: "inline-block", width: 11, height: 11, border: `1.5px solid ${GOLD}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                                                    Translating…
                                                </span>
                                            ) : "Translate"}
                                        </button>
                                        {showPicker === msg.id && (
                                            <LanguagePicker
                                                onSelect={(lang) => handleTranslate(msg, lang)}
                                                onClose={() => setShowPicker(null)}
                                                isMobile={true}
                                            />
                                        )}
                                    </div>
                                    {/* Dive Deeper button */}
                                    {DIVE_DEEPER_ENABLED && index > 0 && messages[index - 1]?.role === "user" && (
                                        <button
                                            onClick={() => {
                                                if (diveDeeperUsed[msg.id]) return
                                                setDiveDeeperUsed(prev => ({ ...prev, [msg.id]: true }))
                                                send(`deepdive: ${messages[index - 1].text.replace(/^(deepdive:\s*)+/i, "")}`)
                                            }}
                                            disabled={loading || diveDeeperUsed[msg.id]}
                                            style={{ ...mobileActionBtnStyle(false), opacity: (loading || diveDeeperUsed[msg.id]) ? 0.4 : 1, cursor: diveDeeperUsed[msg.id] ? "default" : "pointer" }}
                                        >
                                            {diveDeeperUsed[msg.id] ? "Dive Deeper ✓" : "Dive Deeper"}
                                        </button>
                                    )}
                                </div>
                            )}

                            {isAnswerMessage(msg) && <ContributeNote isMobile={isMobile} />}
                        </div>
                    )
                })}
                <div ref={messagesEndRef} />
            </div>
        </div>
    )
}

function InputBar({
    value, onChange, onSend, onKeyDown, disabled, isMobile, hasSidebar, inputRef,
    webMode, onSelectWeb, curatorMode, onSelectCurator,
    attachment, documentError, onFileSelect, onRemoveDocument,
}) {
    const [listening, setListening]   = useState(false)
    const [voiceError, setVoiceError] = useState("")
    const recognitionRef              = useRef(null)
    const silenceTimerRef             = useRef(null)
    const fileInputRef                = useRef(null)
    const ml = hasSidebar ? 220 : 0

    useEffect(() => {
        const el = inputRef.current
        if (!el) return

        // Reset first so the composer can shrink again when text is deleted or sent.
        el.style.height = "auto"

        // Grow with the prompt, then scroll internally once it reaches the cap.
        const maxHeight = isMobile ? 144 : 160
        el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
        el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden"
    }, [value, inputRef, isMobile])

    const supported = typeof window !== "undefined" &&
        ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

    function startListening() {
        if (!supported) { setVoiceError("Voice not supported in this browser"); return }
        setVoiceError("")

        let accumulatedText = ""  // total confirmed text across all sessions
        let isActive = true       // flag to stop restart loop

        // Fix common speech-to-text mishearings of "Jabril"
        function cleanTranscript(text) {
            return text
                .replace(/\bJabra\b/gi, "Jabril")
                .replace(/\bJabriel\b/gi, "Jabril")
                .replace(/\bJabber\b/gi, "Jabril")
                .replace(/\bGabriel\b/gi, "Jabril")
                .replace(/\bJabriel\b/gi, "Jabril")
                .replace(/(\bJabril\b\s*){2,}/gi, "Jabril ")
                .trim()
        }

        function createSession() {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition
            const rec = new SR()
            rec.lang = "en-US"
            rec.interimResults = true
            rec.continuous = false   // OFF — prevents Android double-firing
            rec.maxAlternatives = 1
            recognitionRef.current = rec

            rec.onstart = () => setListening(true)

            rec.onresult = (e) => {
                let sessionFinal = ""
                let sessionInterim = ""

                for (let i = 0; i < e.results.length; i++) {
                    if (e.results[i].isFinal) {
                        sessionFinal += e.results[i][0].transcript + " "
                    } else {
                        sessionInterim = e.results[i][0].transcript
                    }
                }

                const display = cleanTranscript((accumulatedText + sessionFinal + sessionInterim).trim())
                onChange({ target: { value: display } })

                // Lock in final text for this session
                if (sessionFinal) {
                    accumulatedText = cleanTranscript((accumulatedText + sessionFinal).trim()) + " "
                }

                // Reset silence timer
                clearTimeout(silenceTimerRef.current)
                silenceTimerRef.current = setTimeout(() => {
                    isActive = false
                    rec.stop()
                }, 2200)
            }

            rec.onerror = (e) => {
                if (e.error === "no-speech" && isActive) {
                    // Restart silently on no-speech
                    try { rec.stop() } catch(_) {}
                } else if (e.error !== "aborted") {
                    setListening(false)
                    setVoiceError("Mic error: " + e.error)
                    isActive = false
                }
            }

            rec.onend = () => {
                if (isActive) {
                    // Restart to keep listening
                    try { createSession() } catch(_) { setListening(false) }
                } else {
                    setListening(false)
                    clearTimeout(silenceTimerRef.current)
                    if (isMobile) setTimeout(() => onSend(), 100)
                }
            }

            try { rec.start() } catch(_) { setListening(false) }
        }

        createSession()
    }

    function stopListening() {
        clearTimeout(silenceTimerRef.current)
        if (recognitionRef.current) {
            try { recognitionRef.current.abort() } catch(_) {}
            recognitionRef.current = null
        }
        setListening(false)
    }

    return (
        <div style={{
            position: "fixed", bottom: 0,
            left: 0, right: 0,
            background: `linear-gradient(to top, ${BG} 65%, transparent)`,
            paddingBottom: isMobile ? 24 : 32,
            paddingTop: isMobile ? 12 : 16,
            zIndex: 50,
        }}>
            {voiceError && (
                <div style={{ textAlign: "center", color: "#e74c3c", fontSize: 12, marginBottom: 6 }}>
                    {voiceError}
                </div>
            )}
            {listening && (
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                    <span style={{
                        color: GOLD, fontSize: 12, letterSpacing: "0.1em",
                        textTransform: "uppercase", animation: "pulse 1.2s infinite",
                    }}>
                        ● Listening...
                    </span>
                    <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
                </div>
            )}
            {webMode && (attachment || documentError) && (
                <div style={{
                    marginLeft: ml,
                    display: "flex",
                    justifyContent: "center",
                    paddingLeft: isMobile ? 16 : 40,
                    paddingRight: isMobile ? 16 : 40,
                    marginBottom: 8,
                }}>
                    <div style={{ width: "100%", maxWidth: 760 }}>
                        {attachment && (
                            <div style={{
                                display: "inline-flex",
                                maxWidth: "100%",
                                alignItems: "center",
                                gap: 9,
                                padding: "7px 10px",
                                background: `${GOLD}12`,
                                border: `1px solid ${GOLD}55`,
                                borderRadius: 9,
                                color: TEXT,
                                fontSize: 12,
                            }}>
                                <span aria-hidden="true" style={{ color: GOLD }}>▱</span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {attachment.name}
                                </span>
                                <span style={{ color: MUTED, flexShrink: 0 }}>
                                    {(attachment.size / (1024 * 1024)).toFixed(attachment.size < 1024 * 1024 ? 2 : 1)} MB
                                </span>
                                <button
                                    type="button"
                                    onClick={onRemoveDocument}
                                    disabled={disabled}
                                    aria-label={`Remove ${attachment.name}`}
                                    style={{
                                        background: "transparent", border: "none", color: MUTED,
                                        cursor: disabled ? "not-allowed" : "pointer", padding: "0 2px",
                                        fontSize: 15, lineHeight: 1,
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        )}
                        {documentError && (
                            <div role="alert" style={{ color: "#e07070", fontSize: 12, marginTop: attachment ? 6 : 0 }}>
                                {documentError}
                            </div>
                        )}
                    </div>
                </div>
            )}
            <div style={{
                marginLeft: ml,
                display: "flex",
                justifyContent: "center",
                paddingLeft: isMobile ? 16 : 40,
                paddingRight: isMobile ? 16 : 40,
            }}>
                <div style={{
                    width: "100%", maxWidth: 760, display: "flex",
                    gap: isMobile ? 8 : 10, alignItems: "flex-end",
                    flexWrap: isMobile ? "wrap" : "nowrap",
                    ...(isMobile ? {
                        background: PANEL, border: `1px solid ${GOLD}44`,
                        borderRadius: 16, padding: 8, boxSizing: "border-box",
                    } : {}),
                }}>
                    {isMobile ? (
                        <>
                            <button
                                onClick={onSelectCurator}
                                disabled={disabled}
                                title="Ask Jabril using archive-backed Curator intelligence"
                                aria-pressed={!webMode}
                                style={{
                                    background: !webMode ? GOLD : "transparent",
                                    border: `1.5px solid ${GOLD}`, borderRadius: 10,
                                    color: !webMode ? "#0f0f0f" : GOLD,
                                    fontFamily: "inherit", fontSize: 10, fontWeight: 700,
                                    height: 40, padding: "0 7px", minWidth: 55,
                                    cursor: disabled ? "not-allowed" : "pointer",
                                    opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", flexShrink: 0,
                                    letterSpacing: "0.04em", boxShadow: !webMode ? `0 0 12px ${GOLD}55` : "none",
                                }}
                            >JABRIL</button>
                            <button
                                onClick={onSelectWeb}
                                disabled={disabled}
                                title="Search the Web"
                                aria-pressed={webMode}
                                style={{
                                    background: webMode ? GOLD : "transparent",
                                    border: `1.5px solid ${GOLD}`, borderRadius: 10,
                                    color: webMode ? "#0f0f0f" : GOLD,
                                    fontFamily: "inherit", fontSize: 10, fontWeight: 700,
                                    height: 40, padding: "0 7px", minWidth: 42,
                                    cursor: disabled ? "not-allowed" : "pointer",
                                    opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", flexShrink: 0,
                                    letterSpacing: "0.04em",
                                }}
                            >WEB</button>
                        </>
                    ) : (
                        <>
                            {/* Jabril mode — uses the existing Curator path in n8n */}
                            <button
                                onClick={onSelectCurator}
                                disabled={disabled}
                                title="Ask Jabril using archive-backed Curator intelligence"
                                style={{
                                    background: curatorMode && !webMode ? GOLD : "transparent",
                                    border: `1.5px solid ${GOLD}`,
                                    borderRadius: 12,
                                    color: curatorMode && !webMode ? "#0f0f0f" : GOLD,
                                    fontFamily: "inherit",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    padding: "14px 14px",
                                    cursor: disabled ? "not-allowed" : "pointer",
                                    opacity: disabled ? 0.5 : 1,
                                    whiteSpace: "nowrap",
                                    flexShrink: 0,
                                    letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                    transition: "all 0.2s",
                                    minWidth: 74,
                                    boxShadow: curatorMode && !webMode ? `0 0 12px ${GOLD}55` : "none",
                                }}
                                onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.8" }}
                                onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}
                            >
                                Jabril
                            </button>
                            {/* Web mode */}
                            <button
                                onClick={onSelectWeb}
                                disabled={disabled}
                                title="Search the Web"
                                style={{
                                    background: webMode ? GOLD : "transparent",
                                    border: `1.5px solid ${GOLD}`,
                                    borderRadius: 12,
                                    color: webMode ? "#0f0f0f" : GOLD,
                                    fontFamily: "inherit",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    padding: "14px 14px",
                                    cursor: disabled ? "not-allowed" : "pointer",
                                    opacity: disabled ? 0.5 : 1,
                                    whiteSpace: "nowrap",
                                    flexShrink: 0,
                                    letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                    transition: "all 0.2s",
                                    minWidth: 64,
                                }}
                                onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.8" }}
                                onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}
                            >
                                Web
                            </button>
                        </>
                    )}
                    {webMode && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={DOCUMENT_ACCEPT}
                                tabIndex={-1}
                                aria-hidden="true"
                                style={{ display: "none" }}
                                onChange={event => {
                                    const file = event.target.files?.[0]
                                    if (file) onFileSelect(file)
                                    event.target.value = ""
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={disabled}
                                title="Attach a document for live web-assisted enhancement (10 MB max)"
                                aria-label={attachment ? "Replace attached document" : "Attach a document"}
                                style={{
                                    width: isMobile ? 40 : 48,
                                    height: isMobile ? 40 : 48,
                                    display: "grid",
                                    placeItems: "center",
                                    flexShrink: 0,
                                    background: attachment ? `${GOLD}18` : "transparent",
                                    border: `1.5px solid ${GOLD}`,
                                    borderRadius: 12,
                                    color: GOLD,
                                    cursor: disabled ? "not-allowed" : "pointer",
                                    opacity: disabled ? 0.5 : 1,
                                }}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7L9.2 18.2a2 2 0 0 1-2.8-2.8l8.6-8.6"/>
                                </svg>
                            </button>
                        </>
                    )}
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={value}
                        onChange={onChange}
                        onKeyDown={onKeyDown}
                        placeholder={listening ? "Listening..." : attachment ? "Tell Jabril how to improve this document..." : webMode ? "Search the Web..." : "Ask Jabril..."}
                        disabled={disabled}
                        style={{
                            flex: isMobile ? "0 0 100%" : 1,
                            order: isMobile ? -1 : 0,
                            minWidth: 0, minHeight: 48, maxHeight: isMobile ? 144 : 160,
                            background: PANEL,
                            border: `1px solid ${GOLD}`,
                            borderRadius: 12,
                            color: TEXT, fontFamily: "inherit",
                            fontSize: 15, lineHeight: "22px",
                            padding: isMobile ? "12px 14px" : "12px 18px", outline: "none",
                            resize: "none", overflowY: "hidden", boxSizing: "border-box",
                            boxShadow: listening ? `0 0 0 2px ${GOLD}44` : "none",
                            transition: "box-shadow 0.2s",
                        }}
                        onFocus={e => e.target.style.borderColor = GOLD}
                        onBlur={e => e.target.style.borderColor = GOLD}
                    />
                    {/* Mic button — only show if browser supports it */}
                    {supported && (
                        <button
                            onClick={listening ? stopListening : startListening}
                            disabled={disabled}
                            title={listening ? "Stop recording" : "Ask with voice"}
                            style={{
                                background: listening ? GOLD : "transparent",
                                border: `1.5px solid ${GOLD}`,
                                borderRadius: 12,
                                color: listening ? "#0f0f0f" : GOLD,
                                padding: isMobile ? 0 : "14px 16px",
                                width: isMobile ? 40 : undefined,
                                height: isMobile ? 40 : undefined,
                                display: isMobile ? "grid" : undefined,
                                placeItems: isMobile ? "center" : undefined,
                                marginLeft: isMobile ? "auto" : undefined,
                                cursor: disabled ? "not-allowed" : "pointer",
                                opacity: disabled ? 0.5 : 1,
                                fontSize: 18, lineHeight: 1,
                                transition: "all 0.2s",
                                flexShrink: 0,
                            }}
                            onMouseEnter={e => { if (!disabled && !listening) e.currentTarget.style.opacity = "0.8" }}
                            onMouseLeave={e => { if (!listening) e.currentTarget.style.opacity = "1" }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="2" width="6" height="11" rx="3"/>
                                <path d="M5 10a7 7 0 0 0 14 0"/>
                                <line x1="12" y1="19" x2="12" y2="22"/>
                                <line x1="9" y1="22" x2="15" y2="22"/>
                            </svg>
                        </button>
                    )}
                    <button
                        onClick={onSend}
                        disabled={disabled}
                        style={{
                            background: GOLD, border: "none", borderRadius: 12,
                            color: "#0f0f0f", fontFamily: "inherit",
                            fontSize: 13, fontWeight: 500,
                            padding: isMobile ? "0 13px" : "14px 28px",
                            height: isMobile ? 40 : undefined,
                            marginLeft: isMobile && !supported ? "auto" : undefined,
                            cursor: disabled ? "not-allowed" : "pointer",
                            opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
                        }}
                        onMouseEnter={e => { if (!disabled) e.currentTarget.style.transform = "scale(1.02)" }}
                        onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)" }}
                    >
                        Ask
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Quota Bar ────────────────────────────────────────────────────────────────
function QuotaBar({ used, isLoggedIn, isMobile, onRegisterClick }) {
    const remaining = FREE_LIMIT - used
    const pct = Math.min((used / FREE_LIMIT) * 100, 100)
    const isLow = remaining <= 3 && remaining > 0

    // Don't show for logged-in users (they have unlimited)
    if (isLoggedIn) return null

    return (
        <div style={{
            padding: isMobile ? "10px 14px" : "10px 24px",
            borderBottom: `1px solid ${BORDER}`,
            background: PANEL,
            display: "flex", alignItems: "center",
            gap: isMobile ? 8 : 14,
            flexShrink: 0,
            flexWrap: isMobile ? "wrap" : "nowrap",
        }}>
            {/* Explanation text */}
            <span style={{
                fontSize: isMobile ? 11 : 12,
                color: TEXT,
                whiteSpace: "nowrap",
                fontWeight: 500,
            }}>
                {used === 0
                    ? "✦ Try 10 free questions — no account needed"
                    : isLow
                        ? `⚠ Only ${remaining} free question${remaining !== 1 ? "s" : ""} remaining`
                        : `${used} of ${FREE_LIMIT} free questions used`
                }
            </span>

            {/* Progress bar */}
            <div style={{ flex: 1, minWidth: 60, height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                    height: "100%", borderRadius: 2,
                    width: `${pct}%`,
                    background: isLow ? "#c0392b" : GOLD,
                    transition: "width 0.4s ease",
                }} />
            </div>

            {/* Register Free button */}
            <button
                onClick={onRegisterClick}
                style={{
                    background: "transparent",
                    border: `1px solid ${GOLD}`,
                    borderRadius: 6,
                    color: GOLD,
                    fontFamily: "inherit",
                    fontSize: isMobile ? 11 : 12,
                    fontWeight: 600,
                    padding: isMobile ? "5px 10px" : "6px 14px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    letterSpacing: "0.04em",
                    transition: "background 0.2s, color 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = GOLD; e.currentTarget.style.color = "#0f0f0f" }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = GOLD }}
            >
                Sign-up or Sign-In to access chat history
            </button>
        </div>
    )
}

// ─── Signup Gate (shown after 10 free questions, or when requested) ─────────
function SignupGate({ onAuth, onGuest, isMobile, forcePWA = false, headline, subtext }) {
    const hasRegistered = !!localStorage.getItem(REGISTERED_KEY)
    const [tab, setTab]           = useState(hasRegistered ? "login" : "signup")
    const [email, setEmail]       = useState("")
    const [password, setPass]     = useState("")
    const [name, setName]         = useState("")
    const [loading, setLoading]   = useState(false)
    const [error, setError]       = useState("")
    const [showPass, setShowPass] = useState(false)
    const [success, setSuccess]   = useState("")
    const [emailSent, setEmailSent] = useState("")
    const [showForgot, setShowForgot] = useState(false)
    const [resetEmail, setResetEmail] = useState("")
    const [resetSent, setResetSent]   = useState(false)

    async function sendReset() {
        if (!resetEmail) return
        setLoading(true); setError("")
        const { error: e } = await supabase.auth.resetPasswordForEmail(resetEmail, {
            redirectTo: "https://jabrilai.net",
        })
        clearTimeout(timeoutId)
        setLoading(false)
        if (e) setError(e.message)
        else setResetSent(true)
    }

    async function submit() {
        setError(""); setSuccess(""); setLoading(true)
        try {
            if (tab === "signup") {
                const { data, error: e } = await supabase.auth.signUp({
                    email, password,
                    options: { data: { full_name: name } },
                })
                if (e) throw e
                // Always show confirmation prompt after signup — switch to Sign In tab
                // and display a prominent banner regardless of session state
                const signedUpEmail = email
                setTab("login")
                setEmail(signedUpEmail)
                setPass("")
                setEmailSent(signedUpEmail)
                setLoading(false)
                return
            } else {
                const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
                if (e) throw e
                localStorage.setItem(REGISTERED_KEY, "1")
                onAuth(data.user)
            }
        } catch(e) {
            setError(e.message || "Something went wrong.")
        } finally {
            setLoading(false)
        }
    }

    const onKey = e => { if (e.key === "Enter") submit() }

    const inputStyle = {
        width: "100%", background: BG,
        border: `1px solid ${BORDER}`, borderRadius: 8,
        color: TEXT, fontFamily: "'DM Sans', sans-serif",
        fontSize: 14, padding: "11px 14px", outline: "none",
        boxSizing: "border-box",
    }

    const defaultHeadline = tab === "login" ? "Welcome back" : "Continue your research"
    const defaultSubtext  = tab === "login"
        ? "Sign in to access your saved research history."
        : forcePWA
            ? "Create a free account to get started with the full Jabril AI experience."
            : "Create a free account to unlock unlimited access and keep your full research history."

    return (
        <div style={{
            position: "fixed", inset: 0,
            background: forcePWA ? BG : "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 100, padding: "20px",
            backdropFilter: forcePWA ? "none" : "blur(4px)",
        }}>
            <div style={{
                width: "100%", maxWidth: 420,
                background: PANEL, border: `1px solid ${GOLD}33`,
                borderRadius: 16, padding: isMobile ? "32px 24px" : "40px 36px",
            }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                    <img src={logo} alt="Jabril AI" style={{ width: 80, height: "auto" }} />
                </div>
                <h2 style={{
                    fontFamily: "'Cormorant Garamond', serif",
                    fontStyle: "italic", fontWeight: 300,
                    fontSize: 26, color: TEXT, textAlign: "center",
                    marginBottom: 8, lineHeight: 1.3,
                }}>
                    {headline || defaultHeadline}
                </h2>
                <p style={{ color: MUTED, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 1.6 }}>
                    {subtext || defaultSubtext}
                </p>

                {/* Tabs — hide signup tab if already registered */}
                {!hasRegistered && (
                    <div style={{ display: "flex", gap: 2, background: BG, borderRadius: 8, padding: 3, marginBottom: 24 }}>
                        {["signup", "login"].map(t => (
                            <button key={t} onClick={() => { setTab(t); setError(""); setSuccess("") }} style={{
                                flex: 1, padding: "9px", border: "none", borderRadius: 6,
                                background: tab === t ? PANEL : "transparent",
                                color: tab === t ? TEXT : MUTED,
                                fontFamily: "inherit", fontSize: 13, fontWeight: 500,
                                cursor: "pointer", transition: "all 0.2s",
                            }}>
                                {t === "signup" ? "Create Account" : "Sign In"}
                            </button>
                        ))}
                    </div>
                )}

                {emailSent && (
                    <div style={{
                        background: "linear-gradient(135deg, #1a2e1a, #162616)",
                        border: "1px solid #27ae60",
                        borderRadius: 10,
                        padding: "18px 16px",
                        marginBottom: 20,
                        textAlign: "center",
                    }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📧</div>
                        <p style={{ color: "#2ecc71", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                            Check your email!
                        </p>
                        <p style={{ color: "#a8d5a8", fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
                            We sent a confirmation link to
                        </p>
                        <p style={{ color: "#2ecc71", fontSize: 13, fontWeight: 600, marginBottom: 8, wordBreak: "break-all" }}>
                            {emailSent}
                        </p>
                        <p style={{ color: "#7aaa7a", fontSize: 12, lineHeight: 1.6 }}>
                            Click the link in that email first, then come back here and sign in below.
                        </p>
                    </div>
                )}
                {error && <p style={{ color: "#e74c3c", background: "#e74c3c18", border: "1px solid #e74c3c30", borderRadius: 6, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>{error}</p>}
                {success && <p style={{ color: "#27ae60", background: "#27ae6018", border: "1px solid #27ae6030", borderRadius: 6, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>{success}</p>}

                {tab === "signup" && (
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Full Name</label>
                        <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} onKeyDown={onKey} style={inputStyle} />
                    </div>
                )}
                <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Email</label>
                    <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onKey} style={inputStyle} />
                </div>
                <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Password</label>
                    <div style={{ position: "relative" }}>
                        <input type={showPass ? "text" : "password"} placeholder={tab === "signup" ? "Min. 6 characters" : "Your password"} value={password} onChange={e => setPass(e.target.value)} onKeyDown={onKey} style={{ ...inputStyle, paddingRight: 44 }} />
                        <button onClick={() => setShowPass(p => !p)} type="button" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: MUTED, display: "flex", alignItems: "center", padding: 0 }}>
                            {showPass ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                        </button>
                    </div>
                </div>

                {tab === "login" && (
                    <div style={{ marginBottom: 20, textAlign: "right" }}>
                        <button onClick={() => { setShowForgot(true); setResetEmail(email); setError(""); setResetSent(false) }} type="button"
                            style={{ background: "none", border: "none", color: MUTED, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                            onMouseEnter={e => e.currentTarget.style.color = GOLD}
                            onMouseLeave={e => e.currentTarget.style.color = MUTED}
                        >
                            Forgot your password?
                        </button>
                    </div>
                )}
                {tab === "signup" && <div style={{ marginBottom: 20 }} />}

                {/* Forgot password modal */}
                {showForgot && (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
                        <div style={{ width: "100%", maxWidth: 380, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "32px 28px" }}>
                            <h3 style={{ color: TEXT, fontSize: 18, fontWeight: 600, marginBottom: 8, fontFamily: "inherit" }}>Reset your password</h3>
                            <p style={{ color: MUTED, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>Enter your email and we'll send you a link to reset your password.</p>
                            {resetSent ? (
                                <p style={{ color: "#27ae60", background: "#27ae6018", border: "1px solid #27ae6030", borderRadius: 6, padding: "12px", fontSize: 13, textAlign: "center" }}>
                                    ✓ Check your email for the reset link
                                </p>
                            ) : (
                                <>
                                    {error && <p style={{ color: "#e74c3c", fontSize: 13, marginBottom: 12 }}>{error}</p>}
                                    <input
                                        type="email"
                                        placeholder="your@email.com"
                                        value={resetEmail}
                                        onChange={e => setResetEmail(e.target.value)}
                                        style={{ width: "100%", background: BG, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, fontFamily: "inherit", fontSize: 14, padding: "11px 14px", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
                                    />
                                    <button onClick={sendReset} disabled={loading || !resetEmail} style={{ width: "100%", padding: "12px", border: "none", borderRadius: 8, background: GOLD, color: "#0f0f0f", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: !resetEmail ? "not-allowed" : "pointer", opacity: !resetEmail ? 0.6 : 1 }}>
                                        {loading ? "Sending…" : "Send Reset Link"}
                                    </button>
                                </>
                            )}
                            <button onClick={() => { setShowForgot(false); setError("") }} style={{ width: "100%", marginTop: 10, padding: "10px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "transparent", color: MUTED, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
                <button
                    onClick={submit}
                    disabled={loading || !email || !password}
                    style={{
                        width: "100%", padding: "13px", border: "none", borderRadius: 8,
                        background: GOLD, color: "#0f0f0f",
                        fontFamily: "inherit", fontSize: 14, fontWeight: 600,
                        cursor: loading || !email || !password ? "not-allowed" : "pointer",
                        opacity: loading || !email || !password ? 0.6 : 1,
                        transition: "opacity 0.2s",
                    }}
                >
                    {loading ? "Please wait…" : tab === "signup" ? "Create Free Account" : "Sign In"}
                </button>

                {/* Continue as Guest — only on browser (non-PWA) */}
                {!forcePWA && onGuest && (
                    <div style={{ marginTop: 20, textAlign: "center" }}>
                        <button
                            onClick={onGuest}
                            style={{
                                background: "none", border: "none",
                                color: TEXT, fontFamily: "inherit",
                                fontSize: 13, cursor: "pointer", padding: 0,
                                textDecoration: "underline", textUnderlineOffset: 3,
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = GOLD}
                            onMouseLeave={e => e.currentTarget.style.color = TEXT}
                        >
                            Continue as Guest
                        </button>
                        <p style={{ color: MUTED, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                            ✦ Guests get {FREE_LIMIT} free questions — register free to save your history
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Auth Screen (for returning users clicking Sign In) ───────────────────────
function AuthScreen({ onAuth }) {
    const [tab, setTab]         = useState("login")
    const [email, setEmail]     = useState("")
    const [password, setPass]   = useState("")
    const [name, setName]       = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError]       = useState("")
    const [success, setSuccess]   = useState("")
    const [showPass, setShowPass] = useState(false)
    const [showForgot, setShowForgot] = useState(false)
    const [resetEmail, setResetEmail] = useState("")
    const [resetSent, setResetSent]   = useState(false)

    async function sendReset() {
        if (!resetEmail) return
        setLoading(true); setError("")
        const { error: e } = await supabase.auth.resetPasswordForEmail(resetEmail, {
            redirectTo: "https://jabrilai.net",
        })
        setLoading(false)
        if (e) setError(e.message)
        else setResetSent(true)
    }

    async function submit() {
        setError(""); setSuccess(""); setLoading(true)
        try {
            if (tab === "login") {
                const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
                if (e) throw e
                onAuth(data.user)
            } else {
                const { data, error: e } = await supabase.auth.signUp({
                    email, password,
                    options: { data: { full_name: name } },
                })
                if (e) throw e
                if (data.user && !data.session) {
                    setSuccess("Check your email to confirm your account, then sign in.")
                    setTab("login")
                } else if (data.user) {
                    onAuth(data.user)
                }
            }
        } catch(e) {
            setError(e.message || "Something went wrong.")
        } finally {
            setLoading(false)
        }
    }

    const onKey = e => { if (e.key === "Enter") submit() }

    const inputStyle = {
        width: "100%", background: "#0f0f0f",
        border: `1px solid ${BORDER}`, borderRadius: 8,
        color: TEXT, fontFamily: "'DM Sans', sans-serif",
        fontSize: 14, padding: "11px 14px", outline: "none",
        boxSizing: "border-box",
    }

    return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, fontFamily: "'DM Sans', sans-serif" }}>
            <div style={{ width: "100%", maxWidth: 400, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "40px 36px", margin: "0 16px" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                    <img src={logo} alt="Jabril AI" style={{ width: 100, height: "auto" }} />
                </div>
                <p style={{ color: MUTED, fontSize: 14, textAlign: "center", marginBottom: 28 }}>Black Civilization Research Archive</p>
                <div style={{ display: "flex", gap: 2, background: BG, borderRadius: 8, padding: 3, marginBottom: 24 }}>
                    {["login", "signup"].map(t => (
                        <button key={t} onClick={() => { setTab(t); setError(""); setSuccess("") }} style={{
                            flex: 1, padding: "9px", border: "none", borderRadius: 6,
                            background: tab === t ? PANEL : "transparent",
                            color: tab === t ? TEXT : MUTED,
                            fontFamily: "inherit", fontSize: 13, fontWeight: 500,
                            cursor: "pointer", transition: "all 0.2s",
                        }}>
                            {t === "login" ? "Sign In" : "Create Account"}
                        </button>
                    ))}
                </div>
                {error   && <p style={{ color: "#e74c3c", background: "#e74c3c18", border: "1px solid #e74c3c30", borderRadius: 6, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>{error}</p>}
                {success && <p style={{ color: "#27ae60", background: "#27ae6018", border: "1px solid #27ae6030", borderRadius: 6, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>{success}</p>}
                {tab === "signup" && (
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Full Name</label>
                        <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} onKeyDown={onKey} style={inputStyle} />
                    </div>
                )}
                <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Email</label>
                    <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onKey} style={inputStyle} />
                </div>
                <div style={{ marginBottom: 8 }}>
                    <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Password</label>
                    <div style={{ position: "relative" }}>
                        <input type={showPass ? "text" : "password"} placeholder={tab === "signup" ? "Min. 6 characters" : "Your password"} value={password} onChange={e => setPass(e.target.value)} onKeyDown={onKey} style={{ ...inputStyle, paddingRight: 44 }} />
                        <button onClick={() => setShowPass(p => !p)} type="button" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: MUTED, display: "flex", alignItems: "center", padding: 0 }}>
                            {showPass ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                        </button>
                    </div>
                </div>
                {tab === "login" && (
                    <div style={{ marginBottom: 20, textAlign: "right" }}>
                        <button onClick={() => { setShowForgot(true); setResetEmail(email); setError(""); setResetSent(false) }} type="button" style={{ background: "none", border: "none", color: MUTED, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                            onMouseEnter={e => e.currentTarget.style.color = GOLD}
                            onMouseLeave={e => e.currentTarget.style.color = MUTED}
                        >
                            Forgot password?
                        </button>
                    </div>
                )}
                {tab === "signup" && <div style={{ marginBottom: 20 }} />}

                {/* Forgot password modal */}
                {showForgot && (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
                        <div style={{ width: "100%", maxWidth: 380, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "32px 28px" }}>
                            <h3 style={{ color: TEXT, fontSize: 18, fontWeight: 600, marginBottom: 8, fontFamily: "inherit" }}>Reset your password</h3>
                            <p style={{ color: MUTED, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>Enter your email and we'll send you a link to reset your password.</p>
                            {resetSent ? (
                                <p style={{ color: "#27ae60", background: "#27ae6018", border: "1px solid #27ae6030", borderRadius: 6, padding: "12px", fontSize: 13, textAlign: "center" }}>
                                    ✓ Check your email for the reset link
                                </p>
                            ) : (
                                <>
                                    {error && <p style={{ color: "#e74c3c", fontSize: 13, marginBottom: 12 }}>{error}</p>}
                                    <input
                                        type="email"
                                        placeholder="your@email.com"
                                        value={resetEmail}
                                        onChange={e => setResetEmail(e.target.value)}
                                        style={{ width: "100%", background: BG, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, fontFamily: "inherit", fontSize: 14, padding: "11px 14px", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
                                    />
                                    <button onClick={sendReset} disabled={loading || !resetEmail} style={{ width: "100%", padding: "12px", border: "none", borderRadius: 8, background: GOLD, color: "#0f0f0f", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: !resetEmail ? "not-allowed" : "pointer", opacity: !resetEmail ? 0.6 : 1 }}>
                                        {loading ? "Sending…" : "Send Reset Link"}
                                    </button>
                                </>
                            )}
                            <button onClick={() => { setShowForgot(false); setError("") }} style={{ width: "100%", marginTop: 10, padding: "10px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "transparent", color: MUTED, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
                <button onClick={submit} disabled={loading || !email || !password} style={{
                    width: "100%", padding: "13px", border: "none", borderRadius: 8,
                    background: GOLD, color: "#0f0f0f", fontFamily: "inherit",
                    fontSize: 14, fontWeight: 600,
                    cursor: loading || !email || !password ? "not-allowed" : "pointer",
                    opacity: loading || !email || !password ? 0.6 : 1, transition: "opacity 0.2s",
                }}>
                    {loading ? "Please wait…" : tab === "login" ? "Sign In" : "Create Account"}
                </button>
            </div>
        </div>
    )
}

// ─── Reset Password Screen ─────────────────────────────────────────────────────
// Shown when the user lands back on the site via the password-reset email link.
// Supabase's resetPasswordForEmail() only *sends* the email — it does not let
// the user set a new password. That requires a signed-in (recovery) session
// plus a call to supabase.auth.updateUser({ password }), which is what this
// screen does. Detected in App() via the PASSWORD_RECOVERY auth event.
function ResetPasswordScreen({ onDone }) {
    const [password, setPassword]   = useState("")
    const [confirm, setConfirm]     = useState("")
    const [showPass, setShowPass]   = useState(false)
    const [loading, setLoading]     = useState(false)
    const [error, setError]         = useState("")
    const [success, setSuccess]     = useState(false)

    async function submit() {
        setError("")
        if (password.length < 6) {
            setError("Password must be at least 6 characters.")
            return
        }
        if (password !== confirm) {
            setError("Passwords don't match.")
            return
        }
        setLoading(true)
        try {
            const { error: e } = await supabase.auth.updateUser({ password })
            if (e) throw e
            setSuccess(true)
            setTimeout(() => onDone(), 1800)
        } catch (e) {
            setError(e.message || "Something went wrong. Please try the reset link again.")
        } finally {
            setLoading(false)
        }
    }

    const onKey = e => { if (e.key === "Enter") submit() }

    const inputStyle = {
        width: "100%", background: BG,
        border: `1px solid ${BORDER}`, borderRadius: 8,
        color: TEXT, fontFamily: "'DM Sans', sans-serif",
        fontSize: 14, padding: "11px 14px", outline: "none",
        boxSizing: "border-box",
    }

    return (
        <div style={{
            position: "fixed", inset: 0, background: BG,
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 100, padding: "20px",
        }}>
            <div style={{
                width: "100%", maxWidth: 420,
                background: PANEL, border: `1px solid ${GOLD}33`,
                borderRadius: 16, padding: "40px 36px",
            }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                    <img src={logo} alt="Jabril AI" style={{ width: 80, height: "auto" }} />
                </div>
                <h2 style={{
                    fontFamily: "'Cormorant Garamond', serif",
                    fontStyle: "italic", fontWeight: 300,
                    fontSize: 26, color: TEXT, textAlign: "center",
                    marginBottom: 8, lineHeight: 1.3,
                }}>
                    Set a new password
                </h2>
                <p style={{ color: MUTED, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 1.6 }}>
                    Choose a new password for your account.
                </p>

                {success ? (
                    <p style={{ color: "#27ae60", background: "#27ae6018", border: "1px solid #27ae6030", borderRadius: 6, padding: "12px", fontSize: 13, textAlign: "center" }}>
                        ✓ Password updated. Taking you to the app…
                    </p>
                ) : (
                    <>
                        {error && <p style={{ color: "#e74c3c", background: "#e74c3c18", border: "1px solid #e74c3c30", borderRadius: 6, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>{error}</p>}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>New password</label>
                            <div style={{ position: "relative" }}>
                                <input
                                    type={showPass ? "text" : "password"}
                                    placeholder="Min. 6 characters"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    onKeyDown={onKey}
                                    style={{ ...inputStyle, paddingRight: 44 }}
                                    autoFocus
                                />
                                <button onClick={() => setShowPass(p => !p)} type="button" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: MUTED, display: "flex", alignItems: "center", padding: 0 }}>
                                    {showPass ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                                </button>
                            </div>
                        </div>
                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Confirm password</label>
                            <input
                                type={showPass ? "text" : "password"}
                                placeholder="Retype your new password"
                                value={confirm}
                                onChange={e => setConfirm(e.target.value)}
                                onKeyDown={onKey}
                                style={inputStyle}
                            />
                        </div>
                        <button
                            onClick={submit}
                            disabled={loading || !password || !confirm}
                            style={{
                                width: "100%", padding: "13px", border: "none", borderRadius: 8,
                                background: GOLD, color: "#0f0f0f",
                                fontFamily: "inherit", fontSize: 14, fontWeight: 600,
                                cursor: loading || !password || !confirm ? "not-allowed" : "pointer",
                                opacity: loading || !password || !confirm ? 0.6 : 1,
                                transition: "opacity 0.2s",
                            }}
                        >
                            {loading ? "Updating…" : "Update Password"}
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}

function MainApp({ user, onSignOut, onAuthNeeded, showInstall = false }) {
    const [view, setView]                   = useState("welcome")
    const [messages, setMessages]           = useState([])
    const [history, setHistory]             = useState([])
    const [activeId, setActiveId]           = useState(null)
    const [prompt, setPrompt]               = useState("")
    const [loading, setLoading]             = useState(false)
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [questionsUsed, setQuestionsUsed] = useState(() => user ? 0 : getAnonCount())
    const [booting, setBooting]             = useState(!!user)  // only true for logged-in users waiting on DB
    const [showGate, setShowGate]           = useState(false)
    const [triggerInstall, setTriggerInstall] = useState(false)
    const [isInstalled, setIsInstalled]     = useState(() => window.matchMedia("(display-mode: standalone)").matches)
    const messagesEndRef                    = useRef(null)
    const latestMsgRef                      = useRef(null)
    const inputRef                          = useRef(null)
    const [webMode, setWebMode]             = useState(false)
    const [curatorMode, setCuratorMode]     = useState(true)
    const [attachment, setAttachment]       = useState(null)
    const [documentError, setDocumentError] = useState("")
    const [podcastTarget, setPodcastTarget] = useState(null)
    const [podcastCreating, setPodcastCreating] = useState(false)
    const [podcastEpisode, setPodcastEpisode] = useState(null)

    // Mirror the parent showInstall prop into local triggerInstall
    useEffect(() => {
        if (showInstall) setTriggerInstall(true)
    }, [showInstall])

    // Hide Install button once the app is installed
    useEffect(() => {
        const handler = () => setIsInstalled(true)
        window.addEventListener("appinstalled", handler)
        return () => window.removeEventListener("appinstalled", handler)
    }, [])

    // If logged in, load sessions + quota from Supabase
    useEffect(() => {
        if (!user) return
        async function boot() {
            const [sessions, used] = await Promise.all([
                dbGetSessions(user.id),
                getQuestionsUsed(user.id),
            ])
            setHistory(sessions)
            setQuestionsUsed(used)
            setBooting(false)
        }
        boot()
    }, [user])

    useEffect(() => {
        if (view === "chat") {
            setTimeout(() => {
                latestMsgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }, 50)
        }
    }, [messages, view])

    function newChat() {
        setActiveId(null); setMessages([]); setPrompt(""); setView("welcome")
        setAttachment(null); setDocumentError("")
    }

    function selectDocument(file) {
        const error = validateDocument(file)
        if (error) {
            setAttachment(null)
            setDocumentError(error)
            return
        }
        setAttachment(file)
        setDocumentError("")
        // Document enhancement is a Web Mode capability. Keep this guard even
        // though the attachment control is hidden outside Web Mode.
        setCuratorMode(false)
        setWebMode(true)
    }

    async function loadSession(id) {
        const session = history.find(h => h.id === id)
        if (!session) return
        // Clear first so stale messages don't flash
        setMessages([])
        setActiveId(id)
        setView("chat")
        try {
            const dbMsgs = await dbGetMessages(id)
            if (dbMsgs.length === 0) {
                setMessages([{ id: "empty", role: "ai", text: "No messages found in this session." }])
                return
            }
            setMessages(dbMsgs.map(m => ({
                id: m.id,
                // Handle both "assistant" and "ai" stored in DB
                role: (m.role === "assistant" || m.role === "ai") ? "ai" : "user",
                text: m.content,
            })))
        } catch(e) {
            setMessages([{ id: "err", role: "ai", text: "Could not load this session. Please try again." }])
        }
    }

    // Delete one session from Supabase, then sync local state.
    // If the deleted session was the one currently open, fall back to "New Research".
    async function deleteSession(id) {
        if (!user) return
        try {
            await dbDeleteSession(id, user.id)
            setHistory(prev => prev.filter(h => h.id !== id))
            if (activeId === id) newChat()
        } catch (e) {
            console.error("deleteSession error:", e)
            alert("Couldn't delete that session. Please try again.")
        }
    }

    // Delete every session for this user, then reset local state.
    async function clearAllHistory() {
        if (!user) return
        try {
            await dbDeleteAllSessions(user.id)
            setHistory([])
            newChat()
        } catch (e) {
            console.error("clearAllHistory error:", e)
            alert("Couldn't clear your history. Please try again.")
        }
    }

    async function send(queryOverride) {
        const document = attachment
        const typedQuery = String(queryOverride || prompt || "").trim()
        const query = typedQuery || (document
            ? "Review and enhance this document using relevant, credible live web sources."
            : "")
        if (!query || query.length < 2 || loading) return

        // Anonymous user hit the limit — show signup gate
        if (!user && questionsUsed >= FREE_LIMIT) {
            setShowGate(true)
            return
        }

        setPrompt(""); setLoading(true); setView("chat"); setDocumentError("")

        let sessionId = activeId

        // Logged-in: always create a new session for each new question
        if (user && !sessionId) {
            const titleSource = document ? `${document.name}: ${query}` : query
            const title = titleSource.slice(0, 60) + (titleSource.length > 60 ? "…" : "")
            try {
                const newSession = await dbCreateSession(user.id, title)
                sessionId = newSession.id
                setActiveId(sessionId)
                setHistory(prev => [newSession, ...prev.filter(h => h.id !== newSession.id)])
            } catch(e) {
                console.error("Session create error:", e)
            }
        }

        // Anonymous: use local session id
        if (!user && !sessionId) {
            sessionId = `anon-${Date.now()}`
            setActiveId(sessionId)
        }

        const displayQuery = document ? `📎 ${document.name}\n\n${query}` : query
        const userMsg    = { id: `u-${Date.now()}`, role: "user", text: displayQuery }
        const loadingMsg = {
            id: `l-${Date.now()}`,
            role: "loading",
            mode: document ? "document" : webMode ? "web" : "archive",
            text: document ? "Jabril is enhancing your document..." : webMode ? "Searching the web..." : "Jabril is thinking...",
        }
        setMessages(prev => [...prev, userMsg, loadingMsg])

        if (user) await dbSaveMessage(sessionId, user.id, "user", displayQuery)

        let preparedDocument = null
        if (document) {
            try {
                preparedDocument = await prepareDocumentUpload(document)
            } catch (error) {
                const message = error?.message || "Jabril could not read that document. Try a PDF or text file."
                setDocumentError(message)
                setMessages(prev => [
                    ...prev.filter(m => m.role !== "loading"),
                    { id: `e-${Date.now()}`, role: "ai", text: message },
                ])
                setLoading(false)
                return
            }
        }

        // Inject web: prefix only for Web Mode so n8n routes to its live-search path.
        const webhookQuery = document ? query : webMode ? `web: ${query}` : query

        // Pass the signed-in user's existing signup display name to n8n.
        // Anonymous users and accounts without a saved full_name send no name.
        const userName = user
            ? String(user.user_metadata?.full_name || "").trim().slice(0, 120)
            : ""
        const identityFields = userName ? { userName } : {}

        // Build webhook body — curator mode passes flag + prompt for n8n to use
        const webhookBody = curatorMode
            ? { query, sessionId: sessionId ?? "anon", curator: true, ...identityFields }
            : { query: webhookQuery, sessionId: sessionId ?? "anon", ...identityFields }

        // Resolve authentication first so auth/session lookup time does not consume
        // the webhook response window.
        const { data: { session: authSession } } = await supabase.auth.getSession()
        const requestHeaders = {}
        if (authSession?.access_token) {
            requestHeaders.Authorization = `Bearer ${authSession.access_token}`
        }

        let requestUrl = WEBHOOK_URL
        let requestBody
        if (document) {
            requestUrl = DOCUMENT_WEBHOOK_URL
            const form = new FormData()
            form.append("query", query)
            form.append("sessionId", sessionId ?? "anon")
            form.append("mode", "web")
            form.append("fileName", document.name)
            form.append("fileType", document.type || "application/octet-stream")
            form.append("fileSize", String(document.size))
            if (userName) form.append("userName", userName)
            if (preparedDocument?.documentText) {
                form.append("documentText", preparedDocument.documentText)
            } else {
                form.append("document", document, document.name)
            }
            requestBody = form
        } else {
            requestHeaders["Content-Type"] = "application/json"
            requestBody = JSON.stringify(webhookBody)
        }

        // Give the live n8n webhook enough time to extract the document, research
        // current web sources, and return the completed revision.
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 180000)

        try {
            const res = await fetch(requestUrl, {
                method: "POST",
                headers: requestHeaders,
                body: requestBody,
                signal: controller.signal,
            })
            if (!res.ok) throw new Error()
            const raw = await res.text()
            let clean = raw
            try {
                const p = JSON.parse(raw)
                clean = p.output || p.text || (Array.isArray(p) ? (p[0].output || p[0].text) : raw)
            } catch(e) {}
            clean = deduplicateCitations(clean)
            // Only run full cleanMarkdown on archive responses
            // Web responses need their ## headers preserved for formatting
            if (webMode) {
                clean = clean
                    .replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1")
                    .replace(/\\\(|\\\)/g, "").replace(/\\\[/g, "").replace(/\\\]/g, "")
                    .replace(/\\times/g, "×").replace(/\\cdot/g, "·").replace(/\\div/g, "÷")
                    .replace(/\n{3,}/g, "\n\n").trim()
            } else {
                clean = cleanMarkdown(clean)
            }

            const aiMsg = { id: `a-${Date.now()}`, role: "ai", text: clean }
            setMessages(prev => [...prev.filter(m => m.role !== "loading"), aiMsg])
            if (document) {
                setAttachment(null)
                setDocumentError("")
            }

            if (user) {
                await dbSaveMessage(sessionId, user.id, "assistant", clean)
                const newCount = await incrementQuestions(user.id)
                setQuestionsUsed(newCount)
            } else {
                const newCount = incrementAnonCount()
                setQuestionsUsed(newCount)
                // Show gate immediately after the 10th answer
                if (newCount >= FREE_LIMIT) {
                    setTimeout(() => setShowGate(true), 1200)
                }
            }

        } catch(e) {
            const message = e?.name === "AbortError"
                ? (document
                    ? "Web-assisted document enhancement timed out. Please try again."
                    : webMode ? "Web research timed out. Please try again." : "The Archive response timed out before it reached the website. Please try again.")
                : (document
                    ? "Jabril could not process that document with Web research. Check the file and try again."
                    : webMode ? "Connection to Web research was interrupted. Please try again." : "Connection to the Archive interrupted. Please try again.")
            const errMsg = { id: `e-${Date.now()}`, role: "ai", text: message }
            setMessages(prev => [...prev.filter(m => m.role !== "loading"), errMsg])
        } finally {
            clearTimeout(timeoutId)
        }

        setLoading(false)
        setTimeout(() => inputRef.current?.focus(), 50)
    }

    async function createPodcast({ message, question, title, durationMinutes }) {
        if (!user || !message?.text || podcastCreating) return

        setPodcastCreating(true)
        try {
            const { data: { session: authSession } } = await supabase.auth.getSession()
            if (!authSession?.access_token) {
                throw new Error("Your session has expired. Please sign in again.")
            }

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 300000)

            let res
            try {
                res = await fetch(PODCAST_WEBHOOK_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${authSession.access_token}`,
                    },
                    body: JSON.stringify({
                        question: String(question || "").slice(0, 4000),
                        answer: String(message.text || "").slice(0, 30000),
                        title: String(title || "Jabril audio overview").slice(0, 120),
                        durationMinutes: Number(durationMinutes) || 5,
                    }),
                    signal: controller.signal,
                })
            } finally {
                clearTimeout(timeoutId)
            }

            if (!res.ok) {
                const detail = await res.text().catch(() => "")
                throw new Error(
                    res.status === 401 || res.status === 403
                        ? "Podcast creation is restricted to the creator account."
                        : detail || `Podcast service returned HTTP ${res.status}.`
                )
            }

            const blob = await res.blob()
            if (!blob.size) throw new Error("The podcast service returned an empty audio file.")

            const url = URL.createObjectURL(blob)
            setPodcastTarget(null)
            setPodcastEpisode({
                title: String(title || "Jabril audio overview"),
                url,
            })
        } catch (e) {
            console.error("createPodcast error:", e)
            alert(e?.name === "AbortError"
                ? "Podcast generation timed out. Please try again."
                : (e?.message || "Podcast generation failed. Please try again."))
        } finally {
            setPodcastCreating(false)
        }
    }

    function handleAuth(newUser) {
        // Clear anon question counter so logged-in users never see the quota bar again
        localStorage.removeItem(STORAGE_KEY)
        localStorage.setItem(REGISTERED_KEY, "1")
        setShowGate(false)
        onAuthNeeded(newUser)
    }

    const isMobile = window.innerWidth < 768

    if (booting) {
        return (
            <div style={{ display: "flex", width: "100vw", height: "100vh", background: BG, alignItems: "center", justifyContent: "center" }}>
                <img src={logo} alt="Jabril AI" style={{ width: 80, opacity: 0.6 }} />
            </div>
        )
    }

    return (
        <div style={{ display: "flex", width: "100vw", height: "100vh", background: BG, color: TEXT, fontFamily: "'DM Sans', sans-serif", overflow: "hidden", position: "relative" }}>
            {/* Signup gate overlay */}
            {showGate && (
                <SignupGate
                    onAuth={handleAuth}
                    // At the 10-question limit the gate is mandatory.
                    // Before the limit, a guest may close it after choosing to sign up/sign in.
                    onGuest={isPWA() || questionsUsed >= FREE_LIMIT ? null : () => setShowGate(false)}
                    isMobile={isMobile}
                    forcePWA={isPWA()}
                    headline={questionsUsed >= FREE_LIMIT ? "Continue your research" : undefined}
                    subtext={questionsUsed >= FREE_LIMIT
                        ? `You've explored ${FREE_LIMIT} questions. Create a free account to unlock unlimited access and save your research history.`
                        : undefined}
                />
            )}
            {/* Mobile install banner — shown after sign-in or when tapped from header */}
            <InstallBanner triggerShow={triggerInstall} onDismiss={() => setTriggerInstall(false)} />

            {/* Sidebar — fixed panel on desktop, slide-in overlay drawer on mobile */}
            <ContributeThanks />
            {(!isMobile && user) && (
                <Sidebar
                    history={history}
                    activeId={activeId}
                    onSelect={loadSession}
                    onNewChat={newChat}
                    user={user}
                    onSignOut={onSignOut}
                    onDeleteSession={deleteSession}
                    onClearAll={clearAllHistory}
                />
            )}
            {isMobile && user && (
                <Sidebar
                    history={history}
                    activeId={activeId}
                    onSelect={loadSession}
                    onNewChat={newChat}
                    user={user}
                    onSignOut={onSignOut}
                    onDeleteSession={deleteSession}
                    onClearAll={clearAllHistory}
                    isMobile={true}
                    isOpen={mobileMenuOpen}
                    onClose={() => setMobileMenuOpen(false)}
                />
            )}

            <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
                {/* Mobile top-right controls for logged-in users — no header, just floating buttons */}
                {isMobile && user && (
                    <div style={{
                        position: "absolute", top: 12, right: 14,
                        display: "flex", gap: 8, zIndex: 50,
                    }}>
                        {!isPWA() && !isInstalled && (
                            <button
                                onClick={() => setTriggerInstall(true)}
                                style={{
                                    background: "transparent", border: `1px solid ${GOLD}`,
                                    borderRadius: 6, color: GOLD, fontFamily: "inherit",
                                    fontSize: 12, fontWeight: 600, padding: "6px 12px",
                                    cursor: "pointer", whiteSpace: "nowrap",
                                }}
                            >
                                📲 Install
                            </button>
                        )}
                        <a
                            href={CONTRIBUTE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Help preserve and expand the archive"
                            style={{
                                background: "transparent", border: `1px solid ${GOLD}`,
                                borderRadius: 6, color: GOLD, fontFamily: "inherit",
                                fontSize: 12, fontWeight: 600, height: 30, padding: "0 12px",
                                cursor: "pointer", whiteSpace: "nowrap",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                lineHeight: 1, textDecoration: "none",
                            }}
                        >
                            <span style={{ fontSize: 14 }}>♡</span> Contribute
                        </a>
                        <button
                            onClick={() => setMobileMenuOpen(true)}
                            aria-label="Open menu"
                            style={{
                                background: "transparent", border: `1px solid ${BORDER}`,
                                borderRadius: 6, color: MUTED, fontFamily: "inherit",
                                fontSize: 16, width: 34, height: 30, padding: 0, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                lineHeight: 1,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
                        >
                            ☰
                        </button>
                    </div>
                )}
                <QuotaBar used={questionsUsed} isLoggedIn={!!user} isMobile={isMobile} onRegisterClick={() => setShowGate(true)} />
                {view === "welcome"
                    ? <WelcomeScreen onChipClick={send} isMobile={isMobile} />
                    : <ChatArea
                        messages={messages}
                        messagesEndRef={messagesEndRef}
                        latestMsgRef={latestMsgRef}
                        isMobile={isMobile}
                        send={send}
                        loading={loading}
                        onCreatePodcast={user && PODCAST_CREATOR_ID && user.id === PODCAST_CREATOR_ID ? setPodcastTarget : null}
                    />
                }
            </main>

            <InputBar
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onSend={() => send()}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
                disabled={loading}
                isMobile={isMobile}
                hasSidebar={!isMobile && !!user}
                inputRef={inputRef}
                webMode={webMode}
                onSelectWeb={() => {
                    setWebMode(true); setCuratorMode(false); setDocumentError("")
                }}
                curatorMode={curatorMode}
                onSelectCurator={() => {
                    if (attachment) {
                        setDocumentError("Remove the uploaded document before switching to Jabril mode. Document enhancement is available only in Web Mode.")
                        return
                    }
                    setCuratorMode(true); setWebMode(false); setDocumentError("")
                }}
                attachment={attachment}
                documentError={documentError}
                onFileSelect={selectDocument}
                onRemoveDocument={() => { setAttachment(null); setDocumentError("") }}
            />

            {podcastTarget && (
                <PodcastComposer
                    target={podcastTarget}
                    onClose={() => { if (!podcastCreating) setPodcastTarget(null) }}
                    onCreate={createPodcast}
                    isMobile={isMobile}
                    creating={podcastCreating}
                />
            )}

            {podcastEpisode && (
                <PodcastPlayer
                    episode={podcastEpisode}
                    onClose={() => {
                        if (podcastEpisode.url) URL.revokeObjectURL(podcastEpisode.url)
                        setPodcastEpisode(null)
                    }}
                />
            )}
        </div>
    )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
    const [user, setUser]           = useState(undefined)
        const [showInstall, setShowInstall] = useState(false)
    // True while the user is on the site via a "reset your password" email link.
    // Supabase fires a PASSWORD_RECOVERY auth event in that case — we catch it
    // here and show ResetPasswordScreen instead of the normal app/sign-in flow,
    // so an existing logged-in session is never disturbed by mistake.
    const [recoveryMode, setRecoveryMode] = useState(false)

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setUser(data.session?.user ?? null)
        })
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === "PASSWORD_RECOVERY") {
                setRecoveryMode(true)
            }
            setUser(session?.user ?? null)
        })
        return () => subscription.unsubscribe()
    }, [])

    async function handleSignOut() {
        await supabase.auth.signOut()
        setUser(null)
    }

    function handleAuth(u) {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.setItem(REGISTERED_KEY, "1")
        setUser(u)
        // Show install prompt right after sign-in on mobile
        setTimeout(() => setShowInstall(true), 800)
    }

    // User clicked a "reset your password" email link — handle that before
    // anything else, regardless of whether they also happen to have a session.
    if (recoveryMode) {
        return (
            <ResetPasswordScreen
                onDone={() => {
                    setRecoveryMode(false)
                    // Drop the recovery session's URL hash/query so a refresh
                    // doesn't re-trigger this screen, then continue into the app.
                    if (typeof window !== "undefined" && window.history?.replaceState) {
                        window.history.replaceState({}, "", window.location.pathname)
                    }
                }}
            />
        )
    }

    // Still checking session
    if (user === undefined) {
        return (
            <div style={{ display: "flex", width: "100vw", height: "100vh", background: BG, alignItems: "center", justifyContent: "center" }}>
                <img src={logo} alt="Jabril AI" style={{ width: 100, opacity: 0.7 }} />
            </div>
        )
    }

    // Logged-in user — go straight to app
    if (user) {
        return (
            <MainApp
                user={user}
                onSignOut={handleSignOut}
                onAuthNeeded={setUser}
                showInstall={showInstall}
            />
        )
    }

    const pwa       = isPWA()
    const isMobile  = window.innerWidth < 768
    const hasReg    = !!localStorage.getItem(REGISTERED_KEY)

    // PWA install — must register, no guest
    if (pwa) {
        return (
            <SignupGate
                onAuth={handleAuth}
                onGuest={null}
                isMobile={isMobile}
                forcePWA={true}
                headline={hasReg ? "Welcome back" : "Join Jabril AI"}
                subtext={hasReg
                    ? "Sign in to continue your research."
                    : "Create a free account to get started with the full Jabril AI experience."}
            />
        )
    }

    // Browser visits land directly in the anonymous chat.
    // Guests get the existing 10-question browser-local quota; authentication is
    // available from the quota bar and is required once the quota is exhausted.
    return (
        <MainApp
            user={null}
            onSignOut={handleSignOut}
            onAuthNeeded={setUser}
            showInstall={showInstall}
        />
    )
}
