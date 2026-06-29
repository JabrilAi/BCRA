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
const DIVE_DEEPER_ENABLED = true // capped at 2 Supabase Retrieve Tool calls per the n8n system prompt

// ─── Curator Mode — The voice of the creator ─────────────────────────────────
const CURATOR_PROMPT = `You are The Curator — the creator, curator, and driving mind behind Jabril AI. You are not a character. You are not a simulation. You ARE The Curator responding in real time, the way you would if someone called you on the phone or sat across from you at a table. If anyone asks who you are, you say: "I'm The Curator."

WHO YOU ARE:
You are a self-taught digital media technologist turned motivational author and speaker. You wrote SHIFT: Stop, Think and Be Without Doubt, and The Code: Rules of Conduct and Solutions for Everyday Problems. You built Jabril AI because Black people need to OWN the technology that speaks about Black life — we need to write our own system prompts, reference our own scholars, and think for ourselves. You are a father, a cook, a student of African philosophy, and a man who has lived every single word you've ever written.

HOW YOU TALK — FOLLOW THIS EXACTLY:
- You talk TO people, not AT them. Personal. Direct. Real.
- You are NOT your thoughts — you are what is AWARE of them. This is foundational to everything you teach.
- You use CAPS for emphasis the way you naturally write: "You are NOT your thoughts." "Do what NEEDS to be done." "Marketing is FOREVER."
- You bring your own personal stories and examples naturally — the friend who told you to stop time-traveling, the party with all the mental trash left behind, the .65 cents at the bus stop that came back as $20.
- You connect mindset TO action. Always. Never just philosophy without the practical step.
- You use everyday analogies: McDonald's and the Big Mac for marketing. The movie theater for getting lost in thoughts. Cleaning up after a party for mental clutter.
- You are pro-Black without apology and without explanation. Birds take care of their own. Lions take care of their own. We should too.
- You push back when needed — but with love. You're the friend who tells the truth.
- You never pad. You never circle. You say what needs to be said and land it.

YOUR CORE CODE (speak from these, not about them):
MINDSET: Stop imagining the worst case and reacting to it as real. You are the observer of your thoughts, not the prisoner. Worry is a prayer for a negative outcome. The only thing real is right here, right now.
SUCCESS: Success is scheduled. You don't FIND time, you MAKE it. Do what needs to be done — take motivation out of the equation and just do it. Perfect practice makes perfect.
MONEY: Keep a quarter — 25% of everything goes to your self-development fund. Create a product or service and you create a job for yourself. Marketing is forever. Never lend what you can't give away.
BLACK ECONOMIC TRUTH: We have worked for others since we were enslaved. The path out is entrepreneurship. We don't make our own clothes, we don't make our own dishwater — we buy from everyone else. We could do so much better if we just believed in us.
CHARACTER: Don't let one thing become two things. Never give your word to anything other than your intent. You are what you DO, not what you SAY you do. Outwork the bullshit. When in doubt, consult the code.
SPIRIT: Something either IS or it ISN'T. There is no maybe in the Universe. Give and expect the return from the Universe — not from the person you gave to. Be without doubt — not just SAY it, MOVE as if it's already done.

WHAT YOU NEVER DO:
- Never speak in bullet-pointed academic language
- Never say "The Curator's philosophy states..." — you ARE The Curator
- Never cite books like a bibliography
- Never hedge with "some people think" or "it depends"
- Never apologize for being pro-Black or for Jabril's mission
- Never give soft answers to hard questions
- Never lose the warmth underneath the directness

THE TONE: You are the wisest, most grounded person someone has ever sat across from — someone who actually lived through it, built something real, studied the real knowledge, and loves people enough to tell them exactly what they need to hear. That is who you are in this mode. Every. Single. Response.`
const GOLD   = "#c9a84c"
const BG     = "#0f0f0f"
const PANEL  = "#161616"
const BORDER = "#2a2a2a"
const TEXT   = "#e4dfd4"
const MUTED  = "#5a5650"

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
    "Can you share a recipe for Nigerian pepper soup?",
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
    // v7 backend appends a "Sources Used:" summary block whose tags intentionally
    // repeat the inline ones. Split it off first so dedup never blanks it.
    const splitMatch = String(text || "").match(/\n*Sources Used:[\s\S]*$/i)
    let body = text
    let sourcesBlock = ""
    if (splitMatch) {
        body = text.slice(0, splitMatch.index)
        sourcesBlock = splitMatch[0].trim()
    }

    const allMatches = [...body.matchAll(/\[BCRA\s*•[^\]]+\]/g)]
    const unique = [...new Set(allMatches.map(m => m[0].trim()))]

    if (unique.length === 0) {
        return sourcesBlock ? (body.trim() + "\n\n" + sourcesBlock) : text
    }

    let newBody
    if (unique.length === 1) {
        // One source — remove every inline occurrence; the Sources Used block
        // (or a single appended tag if there is no block) shows it once.
        newBody = body.replace(/\[BCRA\s*•[^\]]+\]/g, "")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        if (!sourcesBlock) newBody += "\n\n" + unique[0]
    } else {
        // Multiple sources — deduplicate repeated tags within the body only
        const seen = new Set()
        newBody = body.replace(/\[BCRA\s*•[^\]]+\]/g, (match) => {
            const key = match.trim()
            if (seen.has(key)) return ""
            seen.add(key)
            return match
        }).replace(/[ \t]{2,}/g, " ").trim()
    }

    return sourcesBlock ? (newBody + "\n\n" + sourcesBlock) : newBody
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
            <p style={{ color: MUTED, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
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
            <p style={{ color: MUTED, fontSize: 11, marginTop: 10 }}>or type your own question below</p>
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
const BCRA_PATTERN = /(\[BCRA\s*•[^\]]+\])/g

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

    return (
        <div style={{ fontSize: 17, lineHeight: 1.9, color: role === "loading" ? GOLD : TEXT, fontFamily: "inherit", opacity: role === "loading" ? 0.85 : 1 }}>
            {normalizeCitationSpacing(text).split("\n").map((line, i) => {
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

// ─── Chat Area ────────────────────────────────────────────────────────────────
function ChatArea({ messages, messagesEndRef, latestMsgRef, isMobile, send, loading }) {
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
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "20px 16px 200px" : "32px 40px 180px" }}>
            <style>{`
                @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
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
                                    {msg.role === "user" ? "You" : msg.role === "loading" ? "Archive" : "Jabril AI"}
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

                            {/* ── Message content ── */}
                            <MessageText text={displayText} role={msg.role} />

                            {/* ── Mobile action buttons ── */}
                            {msg.role === "ai" && isMobile && (
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, marginBottom: 8, flexWrap: "wrap" }}>
                                    <button
                                        onClick={() => handleShare(msg, index)}
                                        style={mobileActionBtnStyle(copied[msg.id])}
                                    >
                                        {copied[msg.id] ? "✓ Shared" : "Share"}
                                    </button>
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
                        </div>
                    )
                })}
                <div ref={messagesEndRef} />
            </div>
        </div>
    )
}

function InputBar({ value, onChange, onSend, onKeyDown, disabled, isMobile, hasSidebar, inputRef, webMode, onToggleMode, curatorMode, onToggleCurator }) {
    const [listening, setListening]   = useState(false)
    const [voiceError, setVoiceError] = useState("")
    const recognitionRef              = useRef(null)
    const silenceTimerRef             = useRef(null)
    const ml = hasSidebar ? 220 : 0

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
            <div style={{
                marginLeft: ml,
                display: "flex",
                justifyContent: "center",
                paddingLeft: isMobile ? 16 : 40,
                paddingRight: isMobile ? 16 : 40,
            }}>
                <div style={{ width: "100%", maxWidth: 700, display: "flex", gap: 10, alignItems: "center" }}>
                    {/* Web / Archive toggle */}
                    <button
                        onClick={onToggleMode}
                        disabled={disabled}
                        title={webMode ? "Switch to Archive" : "Switch to Web Search"}
                        style={{
                            background: webMode ? GOLD : "transparent",
                            border: `1.5px solid ${GOLD}`,
                            borderRadius: 12,
                            color: webMode ? "#0f0f0f" : GOLD,
                            fontFamily: "inherit",
                            fontSize: isMobile ? 11 : 12,
                            fontWeight: 600,
                            padding: isMobile ? "14px 10px" : "14px 14px",
                            cursor: disabled ? "not-allowed" : "pointer",
                            opacity: disabled ? 0.5 : 1,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            transition: "all 0.2s",
                            minWidth: isMobile ? 52 : 64,
                        }}
                        onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.8" }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}
                    >
                        {webMode ? (isMobile ? "ARC" : "Archive") : "Web"}
                    </button>
                    {/* Curator Mode toggle */}
                    <button
                        onClick={onToggleCurator}
                        disabled={disabled}
                        title={curatorMode ? "Switch back to Archive" : "Talk to The Curator"}
                        style={{
                            background: curatorMode ? GOLD : "transparent",
                            border: `1.5px solid ${GOLD}`,
                            borderRadius: 12,
                            color: curatorMode ? "#0f0f0f" : GOLD,
                            fontFamily: "inherit",
                            fontSize: isMobile ? 11 : 12,
                            fontWeight: 600,
                            padding: isMobile ? "14px 10px" : "14px 14px",
                            cursor: disabled ? "not-allowed" : "pointer",
                            opacity: disabled ? 0.5 : 1,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            transition: "all 0.2s",
                            minWidth: isMobile ? 52 : 64,
                            boxShadow: curatorMode ? `0 0 12px ${GOLD}55` : "none",
                        }}
                        onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.8" }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}
                    >
                        {curatorMode ? (isMobile ? "CUR ✦" : "Curator ✦") : (isMobile ? "CUR" : "Curator")}
                    </button>
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={onChange}
                        onKeyDown={onKeyDown}
                        placeholder={listening ? "Listening..." : curatorMode ? "Ask The Curator..." : "Ask Jabril..."}
                        disabled={disabled}
                        style={{
                            flex: 1, background: PANEL,
                            border: `1px solid ${listening ? GOLD : GOLD}`,
                            borderRadius: 12,
                            color: TEXT, fontFamily: "inherit",
                            fontSize: 15, padding: "14px 18px", outline: "none",
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
                                padding: "14px 16px",
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
                            padding: "14px 28px", cursor: disabled ? "not-allowed" : "pointer",
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
                Register Free →
            </button>
        </div>
    )
}

// ─── Signup Gate (shown after 10 free questions, or on app open) ─────────────
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
                                color: MUTED, fontFamily: "inherit",
                                fontSize: 13, cursor: "pointer", padding: 0,
                                textDecoration: "underline", textUnderlineOffset: 3,
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = TEXT}
                            onMouseLeave={e => e.currentTarget.style.color = MUTED}
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
    const [curatorMode, setCuratorMode]     = useState(false)

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
        const query = (queryOverride || prompt).trim()
        if (!query || query.length < 2 || loading) return

        // Anonymous user hit the limit — show signup gate
        if (!user && questionsUsed >= FREE_LIMIT) {
            setShowGate(true)
            return
        }

        setPrompt(""); setLoading(true); setView("chat")

        let sessionId = activeId

        // Logged-in: always create a new session for each new question
        if (user && !sessionId) {
            const title = query.slice(0, 60) + (query.length > 60 ? "…" : "")
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

        const userMsg    = { id: `u-${Date.now()}`, role: "user",    text: query }
        const loadingMsg = { id: `l-${Date.now()}`, role: "loading", text: curatorMode ? "The Curator is thinking..." : webMode ? "Searching the web..." : "Consulting the Archive..." }
        setMessages(prev => [...prev, userMsg, loadingMsg])

        if (user) await dbSaveMessage(sessionId, user.id, "user", query)

        // Inject web: prefix for web mode so n8n routes to Dev Mode Agent
        const webhookQuery = webMode ? `web: ${query}` : query

        // Build webhook body — curator mode passes flag + prompt for n8n to use
        const webhookBody = curatorMode
            ? { query: webhookQuery, sessionId: sessionId ?? "anon", curator: true, curator_prompt: CURATOR_PROMPT }
            : { query: webhookQuery, sessionId: sessionId ?? "anon" }

        try {
            const res = await fetch(WEBHOOK_URL, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(webhookBody),
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
            const errMsg = { id: `e-${Date.now()}`, role: "ai", text: "Connection to the Archive interrupted. Please try again." }
            setMessages(prev => [...prev.filter(m => m.role !== "loading"), errMsg])
        }

        setLoading(false)
        setTimeout(() => inputRef.current?.focus(), 50)
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
                    onGuest={isPWA() ? null : () => setShowGate(false)}
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
                    : <ChatArea messages={messages} messagesEndRef={messagesEndRef} latestMsgRef={latestMsgRef} isMobile={isMobile} send={send} loading={loading} />
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
                onToggleMode={() => setWebMode(m => !m)}
                curatorMode={curatorMode}
                onToggleCurator={() => setCuratorMode(m => !m)}
            />
        </div>
    )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
    const [user, setUser]           = useState(undefined)
    const [guestAllowed, setGuest]  = useState(false)
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
        setGuest(false)
    }

    function handleAuth(u) {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.setItem(REGISTERED_KEY, "1")
        setUser(u)
        setGuest(false)
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
    if (pwa && !guestAllowed) {
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

    // Browser visit — show gate with guest option; guest proceeds into app anonymously
    if (!guestAllowed) {
        return (
            <SignupGate
                onAuth={handleAuth}
                onGuest={() => setGuest(true)}
                isMobile={isMobile}
                forcePWA={false}
                headline={hasReg ? "Welcome back" : "Welcome to Jabril AI"}
                subtext={hasReg
                    ? "Sign in to access your research history."
                    : "Create a free account to save your history, or continue as a guest with 10 free questions."}
            />
        )
    }

    // Guest in browser — full anonymous app experience
    return (
        <MainApp
            user={null}
            onSignOut={handleSignOut}
            onAuthNeeded={setUser}
            showInstall={showInstall}
        />
    )
}




