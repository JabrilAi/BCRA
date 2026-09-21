
// ─── Constants & utilities (unchanged) ───────────────────────────────────────
const WEBHOOK_URL = "https://anthonyai.app.n8n.cloud/webhook/11"
// Creator-only podcast endpoint. Keep the creator id in the deployment
// environment instead of the source code. The n8n workflow independently
// verifies the same user id, so hiding the button is never the only control.
const PODCAST_WEBHOOK_URL = import.meta.env.VITE_PODCAST_WEBHOOK_URL || "https://anthonyai.app.n8n.cloud/webhook/jabril-podcast"
const PODCAST_CREATOR_ID = import.meta.env.VITE_PODCAST_CREATOR_ID || ""
const DIVE_DEEPER_ENABLED = true // capped at 2 Supabase Retrieve Tool calls per the n8n system prompt

// ─── Curator Mode instructions now live securely in n8n ─────────────────────

    return msg.role === "ai" && !/^(e-|empty$|err$)/.test(String(msg.id))
}

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

// Shown under every Jabril answer. Lives outside the message text, so Share, Print
// and Translate (which work from msg.text) never include it.
function ContributeNote({ isMobile }) {

    )
}

function PodcastComposer({ target, onClose, onCreate, isMobile }) {
    const [duration, setDuration] = useState(5)
    const [title, setTitle] = useState("")

    useEffect(() => {
        setDuration(5)
        setTitle(target?.question ? target.question.slice(0, 90) : "")
    }, [target?.message?.id])

    if (!target) return null

    const sourceCount = getBcraSources(target.message.text).length
    const submit = () => onCreate({
        message: target.message,
        question: target.question,
        title: title.trim(),
        durationMinutes: duration,
    })

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="podcast-title"
            style={{ position: "fixed", inset: 0, zIndex: 150, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(4px)" }}
            onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <section style={{ width: "100%", maxWidth: 520, background: PANEL, border: `1px solid ${GOLD}55`, borderRadius: 16, padding: isMobile ? "28px 22px" : "34px 32px", boxShadow: "0 20px 56px rgba(0,0,0,0.55)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
                    <div>
                        <div style={{ color: GOLD, fontSize: 11, letterSpacing: "0.13em", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Creator studio</div>
                        <h2 id="podcast-title" style={{ margin: 0, color: TEXT, fontFamily: "'Cormorant Garamond', serif", fontSize: 30, fontWeight: 500 }}>Create audio overview</h2>
                    </div>
                    <button onClick={onClose} aria-label="Close podcast creator" style={{ background: "transparent", border: "none", color: MUTED, fontSize: 22, lineHeight: 1, cursor: "pointer", padding: 2 }}>×</button>
                </div>
                <p style={{ color: "#aaa49c", fontSize: 14, lineHeight: 1.6, margin: "0 0 22px" }}>
                    Two hosts will discuss this Jabril answer using only its archive-grounded content. Review the original answer and its sources before publishing.
                </p>
                <label style={{ display: "block", color: "#bbb5ad", fontSize: 12, fontWeight: 600, marginBottom: 7 }}>Episode title</label>
                <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={120}
                    placeholder="Give this episode a title"
                    style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 8, background: BG, border: `1px solid ${BORDER}`, color: TEXT, fontFamily: "inherit", fontSize: 14, outline: "none", marginBottom: 20 }}
                />
                <label style={{ display: "block", color: "#bbb5ad", fontSize: 12, fontWeight: 600, marginBottom: 9 }}>Target length</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                    {[2, 5, 10].map(minutes => (
                        <button key={minutes} onClick={() => setDuration(minutes)} style={{ background: duration === minutes ? `${GOLD}20` : "transparent", border: `1px solid ${duration === minutes ? GOLD : BORDER}`, borderRadius: 7, color: duration === minutes ? GOLD : MUTED, fontFamily: "inherit", fontSize: 13, padding: "8px 13px", cursor: "pointer" }}>{minutes} min</button>
                    ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: MUTED, fontSize: 12, lineHeight: 1.45, marginBottom: 24, padding: "10px 12px", background: "#0f0f0f", borderRadius: 8, border: `1px solid ${BORDER}` }}>
                    <span>{sourceCount ? `${sourceCount} archive source${sourceCount === 1 ? "" : "s"} will guide the script.` : "No BCRA citations were found; review this answer before publishing."}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "10px 14px", fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
                    <button onClick={submit} style={{ background: GOLD, border: `1px solid ${GOLD}`, color: BG, borderRadius: 7, padding: "10px 15px", fontFamily: "inherit", fontWeight: 700, cursor: "pointer" }}>Generate podcast</button>
                </div>
            </section>
        </div>
