import { useState, useRef, useEffect } from "react"
import logo from "../JAI-Logo-web.png"

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
                    background: "transparent",
                    border: "none",
                    borderRadius: 100,
                    color: TEXT,
                    fontFamily: "'Cormorant Garamond', serif",
                    fontStyle: "italic",
                    fontSize: 18,
                    padding: "12px 28px",
                    cursor: "pointer",
                    maxWidth: 560,
                    lineHeight: 1.4,
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

function Sidebar({ history, activeId, onSelect, onNewChat }) {
    return (
        <aside style={{
            width: 220, minWidth: 220,
            background: PANEL,
            borderRight: `1px solid ${BORDER}`,
            display: "flex", flexDirection: "column",
            height: "100vh", overflowY: "auto", flexShrink: 0,
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
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "20px 16px 160px" : "32px 40px 180px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
                {messages.map((msg, index) => (
                    <div key={msg.id}
                        ref={index === messages.length - 1 ? latestMsgRef : null}
                        style={{ padding: "20px 0", borderBottom: `1px solid ${BORDER}` }}>
                        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", marginBottom: 10, gap: isMobile ? 8 : 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: msg.role === "user" ? GOLD : MUTED }}>
                                {msg.role === "user" ? "You" : msg.role === "loading" ? "Archive" : "Jabril AI"}
                            </div>
                            {msg.role === "ai" && (
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
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
        </div>
    )
}

function InputBar({ value, onChange, onSend, onKeyDown, disabled, isMobile }) {
    return (
        <div style={{
            position: "fixed", bottom: 0,
            left: isMobile ? 0 : 220, right: 0,
            background: `linear-gradient(to top, ${BG} 65%, transparent)`,
            padding: isMobile ? "12px 16px 24px" : "16px 40px 32px",
            display: "flex", justifyContent: "center",
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

export default function App() {
    const [view, setView]         = useState("welcome")
    const [messages, setMessages] = useState([])
    const [history, setHistory]   = useState([])
    const [activeId, setActiveId] = useState(null)
    const [prompt, setPrompt]     = useState("")
    const [loading, setLoading]   = useState(false)
    const messagesEndRef           = useRef(null)
    const latestMsgRef             = useRef(null)

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

    function loadSession(id) {
        const s = history.find(h => h.id === id)
        if (!s) return
        setActiveId(id); setMessages(s.messages); setView("chat")
    }

    function updateHistory(id, title, msgs) {
        setHistory(prev => {
            const i = prev.findIndex(h => h.id === id)
            if (i >= 0) { const u = [...prev]; u[i] = { ...u[i], messages: msgs }; return u }
            return [{ id, title, messages: msgs }, ...prev].slice(0, 20)
        })
    }

    async function send(queryOverride) {
        const query = (queryOverride || prompt).trim()
        if (!query || query.length < 2 || loading) return
        setPrompt(""); setLoading(true)
        const sessionId = activeId || `id-${Date.now()}`
        if (!activeId) setActiveId(sessionId)
        setView("chat")
        const userMsg    = { id: `u-${Date.now()}`, role: "user",    text: query }
        const loadingMsg = { id: `l-${Date.now()}`, role: "loading", text: "Consulting the Archive..." }
        setMessages(prev => { const n = [...prev, userMsg, loadingMsg]; updateHistory(sessionId, query, n); return n })
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
            setMessages(prev => { const n = [...prev.filter(m => m.role !== "loading"), aiMsg]; updateHistory(sessionId, query, n); return n })
        } catch(e) {
            const errMsg = { id: `e-${Date.now()}`, role: "ai", text: "Connection to the Archive interrupted. Please try again." }
            setMessages(prev => { const n = [...prev.filter(m => m.role !== "loading"), errMsg]; updateHistory(sessionId, query, n); return n })
        }
        setLoading(false)
    }

    const isMobile = window.innerWidth < 768

    return (
        <div style={{ display: "flex", width: "100vw", height: "100vh", background: BG, color: TEXT, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
            {!isMobile && <Sidebar history={history} activeId={activeId} onSelect={loadSession} onNewChat={newChat} />}
            <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
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
            />
        </div>
    )
}
