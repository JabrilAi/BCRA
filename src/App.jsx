import { useState, useRef, useEffect } from "react"
import { createClient } from "@supabase/supabase-js"
import logo from "../JAI-Logo-web.png"

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
    "https://nixpunwfkmnsxkqfhzcc.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5peHB1bndma21uc3hrcWZoemNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MDAwMDcsImV4cCI6MjA5NDk3NjAwN30.xd2gNzXItM_yfhKe1nwnjBO4sDFyoyU5b3dFeqRdnyw"
)

const FREE_LIMIT = 10
const STORAGE_KEY = "jabrilai_questions_used"

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

async function dbSaveMessage(sessionId, role, content) {
    await supabase.from("chat_messages").insert({ session_id: sessionId, role, content })
}

// ─── Constants & utilities (unchanged) ───────────────────────────────────────
const WEBHOOK_URL = "https://anthonyai.app.n8n.cloud/webhook/11"
const GOLD   = "#c9a84c"
const BG     = "#0f0f0f"
const PANEL  = "#161616"
const BORDER = "#2a2a2a"
const TEXT   = "#e4dfd4"
const MUTED  = "#5a5650"

const EXAMPLE_QUESTIONS = [
    "Who were the Moors and how did they shape Europe?",
    "What is Kemetic spirituality?",
    "How did the Transatlantic slave trade affect Black mental health today?",
    "What did Marcus Garvey believe?",
    "What healing foods come from African traditions?",
    "Who was Cheikh Anta Diop and why does he matter?",
    "What is the connection between melanin and consciousness?",
    "How did enslaved Africans preserve their culture?",
    "What Black philosophers should everyone know?",
    "How does systemic racism affect Black health outcomes?",
    "What are traditional African relationship values?",
    "What did soul food mean to enslaved Black Americans?",
    "How do Black women navigate love and partnership?",
    "What African herbs and plants have healing properties?",
    "What is the history of Juneteenth?",
    "How did the Black Panthers address community health?",
    "What is Ubuntu philosophy and how does it apply today?",
    "What foods did West Africans eat before colonization?",
    "How does the Black church influence relationships?",
    "What can Black men learn from African rites of passage?",
]

function cleanMarkdown(text) {
    return text
        .replace(/###\s*/g, "").replace(/##\s*/g, "").replace(/#\s*/g, "")
        .replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1")
        .replace(/^\s*[-•]\s*/gm, "\n• ").replace(/\n{3,}/g, "\n\n").trim()
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

function printConversation(messages) {
    const content = messages
        .filter(m => m.role !== "loading")
        .map(m => `<div class="${m.role}"><strong>${m.role === "user" ? "You" : "Jabril AI"}</strong><p>${m.text.replace(/\n/g, "<br/>")}</p></div>`)
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
    const [index, setIndex] = useState(0)
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
                    fontStyle: "italic", fontSize: 18, padding: "12px 28px",
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

function Sidebar({ history, activeId, onSelect, onNewChat, user, onSignOut }) {
    return (
        <aside style={{
            width: 220, minWidth: 220, background: PANEL,
            borderRight: `1px solid ${BORDER}`, display: "flex",
            flexDirection: "column", height: "100vh", overflowY: "auto", flexShrink: 0,
        }}>
            <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "center" }}>
                <img src={logo} alt="Jabril AI" style={{ width: 80, height: "auto" }} />
            </div>
            <div style={{ padding: "14px 12px 8px" }}>
                <button onClick={onNewChat} style={{
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
            <div style={{ padding: "6px 12px 4px" }}>
                <span style={{ fontSize: 13, color: MUTED, letterSpacing: "0.12em", textTransform: "uppercase" }}>Recent</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
                {history.length === 0 && (
                    <p style={{ fontSize: 14, color: MUTED, padding: "8px 8px", lineHeight: 1.5 }}>
                        Your research sessions will appear here.
                    </p>
                )}
                {history.map(item => (
                    <button key={item.id} onClick={() => onSelect(item.id)} style={{
                        width: "100%", background: item.id === activeId ? "rgba(201,168,76,0.08)" : "transparent",
                        border: "none", borderRadius: 6, padding: "8px 10px",
                        cursor: "pointer", textAlign: "left", display: "block",
                        color: item.id === activeId ? TEXT : MUTED,
                        fontSize: 12, fontFamily: "inherit",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        lineHeight: 1.4,
                    }}>
                        {item.title}
                    </button>
                ))}
            </div>
            <div style={{ padding: "12px", borderTop: `1px solid ${BORDER}` }}>
                <p style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 8 }}>
                    {user?.email}
                </p>
                <button
                    onClick={onSignOut}
                    style={{
                        width: "100%", background: "transparent",
                        border: `1px solid ${BORDER}`, borderRadius: 6,
                        color: MUTED, fontFamily: "inherit", fontSize: 12,
                        padding: "7px 10px", cursor: "pointer",
                        transition: "border-color 0.2s, color 0.2s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#c0392b"; e.currentTarget.style.color = "#c0392b" }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
                >
                    Sign Out
                </button>
            </div>
        </aside>
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
            <p style={{ color: GOLD, fontSize: 19, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>
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

function ChatArea({ messages, messagesEndRef, latestMsgRef, isMobile }) {
    const [copied, setCopied] = useState({})

    function handleShare(msg, index) {
        const question = messages[index - 1]?.text || ""
        shareMessage(question, msg.text)
        setCopied(prev => ({ ...prev, [msg.id]: true }))
        setTimeout(() => setCopied(prev => ({ ...prev, [msg.id]: false })), 2000)
    }

    return (
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "20px 16px 200px" : "32px 40px 180px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
                {messages.map((msg, index) => (
                    <div key={msg.id}
                        ref={index === messages.length - 1 ? latestMsgRef : null}
                        style={{ padding: "20px 0", borderBottom: `1px solid ${BORDER}` }}>
                        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", marginBottom: 10, gap: isMobile ? 8 : 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: msg.role === "user" ? GOLD : MUTED }}>
                                {msg.role === "user" ? "You" : msg.role === "loading" ? "Archive" : "Jabril AI"}
                            </div>
                            {msg.role === "ai" && !isMobile && (
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                        onClick={() => handleShare(msg, index)}
                                        style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 6, color: copied[msg.id] ? GOLD : MUTED, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}
                                        onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD }}
                                        onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = copied[msg.id] ? GOLD : MUTED }}
                                    >
                                        {copied[msg.id] ? "✓ Copied" : "Share"}
                                    </button>
                                    <button
                                        onClick={() => printConversation(messages.slice(0, index + 1))}
                                        style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 6, color: MUTED, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}
                                        onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD }}
                                        onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED }}
                                    >
                                        Print
                                    </button>
                                </div>
                            )}
                        </div>
                        <div style={{ fontSize: 17, lineHeight: 1.9, color: msg.role === "loading" ? GOLD : TEXT, fontFamily: "inherit", opacity: msg.role === "loading" ? 0.85 : 1 }}>
                            {msg.text.split("\n").map((line, i) => line.trim() === "" ? null : (
                                <p key={i} style={{ marginBottom: line.startsWith("•") ? 10 : 6, paddingLeft: line.startsWith("•") ? 12 : 0 }}>
                                    {line}
                                </p>
                            ))}
                        </div>
                        {msg.role === "ai" && isMobile && (
                            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, marginBottom: 8 }}>
                                <button
                                    onClick={() => handleShare(msg, index)}
                                    style={{
                                        background: "transparent", border: `1px solid ${BORDER}`,
                                        borderRadius: 6, color: copied[msg.id] ? GOLD : "#9a9590",
                                        fontSize: 13, fontWeight: 500, padding: "6px 16px",
                                        cursor: "pointer", fontFamily: "inherit",
                                    }}
                                >
                                    {copied[msg.id] ? "✓ Shared" : "Share"}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
        </div>
    )
}

function InputBar({ value, onChange, onSend, onKeyDown, disabled, isMobile, hasSidebar }) {
    const leftOffset = hasSidebar ? 220 : 0
    return (
        <div style={{
            position: "fixed", bottom: 0,
            left: 0, right: 0,
            background: `linear-gradient(to top, ${BG} 65%, transparent)`,
            padding: isMobile ? "12px 16px 24px" : "16px 40px 32px",
            display: "flex", justifyContent: "center",
            paddingLeft: hasSidebar ? 220 : 0,
            zIndex: 50,
        }}>
            <div style={{ width: "100%", maxWidth: 700, display: "flex", gap: 10, alignItems: "center" }}>
                <input
                    value={value}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    placeholder="Ask Jabril..."
                    disabled={disabled}
                    style={{
                        flex: 1, background: PANEL,
                        border: `1px solid ${GOLD}`, borderRadius: 12,
                        color: TEXT, fontFamily: "inherit",
                        fontSize: 15, padding: "14px 18px", outline: "none",
                    }}
                    onFocus={e => e.target.style.borderColor = GOLD}
                    onBlur={e => e.target.style.borderColor = GOLD}
                />
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

// ─── Signup Gate (shown after 10 free questions) ──────────────────────────────
function SignupGate({ onAuth, isMobile }) {
    const [tab, setTab]         = useState("signup")
    const [email, setEmail]     = useState("")
    const [password, setPass]   = useState("")
    const [name, setName]       = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError]     = useState("")

    async function submit() {
        setError(""); setLoading(true)
        try {
            if (tab === "signup") {
                const { data, error: e } = await supabase.auth.signUp({
                    email, password,
                    options: { data: { full_name: name } },
                })
                if (e) throw e
                if (data.user) onAuth(data.user)
            } else {
                const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
                if (e) throw e
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

    return (
        <div style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 100, padding: "20px",
            backdropFilter: "blur(4px)",
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
                    Continue your research
                </h2>
                <p style={{ color: MUTED, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 1.6 }}>
                    You've explored {FREE_LIMIT} questions. Create a free account to unlock unlimited access and save your research history.
                </p>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 2, background: BG, borderRadius: 8, padding: 3, marginBottom: 24 }}>
                    {["signup", "login"].map(t => (
                        <button key={t} onClick={() => { setTab(t); setError("") }} style={{
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

                {error && <p style={{ color: "#e74c3c", background: "#e74c3c18", border: "1px solid #e74c3c30", borderRadius: 6, padding: "9px 12px", fontSize: 13, marginBottom: 14 }}>{error}</p>}

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
                    <input type="password" placeholder={tab === "signup" ? "Min. 6 characters" : "Your password"} value={password} onChange={e => setPass(e.target.value)} onKeyDown={onKey} style={inputStyle} />
                </div>
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
    const [error, setError]     = useState("")
    const [success, setSuccess] = useState("")

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
                <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6 }}>Password</label>
                    <input type="password" placeholder={tab === "signup" ? "Min. 6 characters" : "Your password"} value={password} onChange={e => setPass(e.target.value)} onKeyDown={onKey} style={inputStyle} />
                </div>
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

// ─── Main App ─────────────────────────────────────────────────────────────────
function MainApp({ user, onSignOut, onAuthNeeded }) {
    const [view, setView]                   = useState("welcome")
    const [messages, setMessages]           = useState([])
    const [history, setHistory]             = useState([])
    const [activeId, setActiveId]           = useState(null)
    const [prompt, setPrompt]               = useState("")
    const [loading, setLoading]             = useState(false)
    const [questionsUsed, setQuestionsUsed] = useState(() => user ? 0 : getAnonCount())
    const [booting, setBooting]             = useState(!!user)  // only true for logged-in users waiting on DB
    const [showGate, setShowGate]           = useState(false)
    const messagesEndRef                    = useRef(null)
    const latestMsgRef                      = useRef(null)

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
        setActiveId(id); setView("chat")
        const dbMsgs = await dbGetMessages(id)
        setMessages(dbMsgs.map(m => ({
            id: m.id,
            role: m.role === "assistant" ? "ai" : m.role,
            text: m.content,
        })))
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

        // Logged-in: persist session to Supabase
        if (user && !sessionId) {
            const title = query.slice(0, 60) + (query.length > 60 ? "…" : "")
            const newSession = await dbCreateSession(user.id, title)
            sessionId = newSession.id
            setActiveId(sessionId)
            setHistory(prev => [newSession, ...prev])
        }

        // Anonymous: use local session id
        if (!user && !sessionId) {
            sessionId = `anon-${Date.now()}`
            setActiveId(sessionId)
        }

        const userMsg    = { id: `u-${Date.now()}`, role: "user",    text: query }
        const loadingMsg = { id: `l-${Date.now()}`, role: "loading", text: "Consulting the Archive..." }
        setMessages(prev => [...prev, userMsg, loadingMsg])

        if (user) await dbSaveMessage(sessionId, "user", query)

        try {
            const res = await fetch(WEBHOOK_URL, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, sessionId: "researcher-session" }),
            })
            if (!res.ok) throw new Error()
            const raw = await res.text()
            let clean = raw
            try {
                const p = JSON.parse(raw)
                clean = p.output || p.text || (Array.isArray(p) ? (p[0].output || p[0].text) : raw)
            } catch(e) {}
            clean = cleanMarkdown(clean)

            const aiMsg = { id: `a-${Date.now()}`, role: "ai", text: clean }
            setMessages(prev => [...prev.filter(m => m.role !== "loading"), aiMsg])

            if (user) {
                await dbSaveMessage(sessionId, "assistant", clean)
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
    }

    function handleAuth(newUser) {
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
        <div style={{ display: "flex", width: "100vw", height: "100vh", background: BG, color: TEXT, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
            {/* Signup gate overlay */}
            {showGate && <SignupGate onAuth={handleAuth} isMobile={isMobile} />}

            {/* Sidebar only for logged-in users */}
            {!isMobile && user && (
                <Sidebar
                    history={history}
                    activeId={activeId}
                    onSelect={loadSession}
                    onNewChat={newChat}
                    user={user}
                    onSignOut={onSignOut}
                />
            )}

            <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
                <QuotaBar used={questionsUsed} isLoggedIn={!!user} isMobile={isMobile} onRegisterClick={() => setShowGate(true)} />
                {view === "welcome"
                    ? <WelcomeScreen onChipClick={send} isMobile={isMobile} />
                    : <ChatArea messages={messages} messagesEndRef={messagesEndRef} latestMsgRef={latestMsgRef} isMobile={isMobile} />
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
            />
        </div>
    )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
    const [user, setUser]         = useState(undefined)
    const [showLogin, setShowLogin] = useState(false)

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setUser(data.session?.user ?? null)
        })
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null)
        })
        return () => subscription.unsubscribe()
    }, [])

    async function handleSignOut() {
        await supabase.auth.signOut()
        setUser(null)
    }

    // Still checking session
    if (user === undefined) {
        return (
            <div style={{ display: "flex", width: "100vw", height: "100vh", background: BG, alignItems: "center", justifyContent: "center" }}>
                <img src={logo} alt="Jabril AI" style={{ width: 100, opacity: 0.7 }} />
            </div>
        )
    }

    // Returning user explicitly clicked Sign In
    if (showLogin && !user) {
        return <AuthScreen onAuth={u => { setUser(u); setShowLogin(false) }} />
    }

    // All users (anonymous or logged in) go straight to the app
    return (
        <MainApp
            user={user}
            onSignOut={handleSignOut}
            onAuthNeeded={setUser}
        />
    )
}
