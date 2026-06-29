// ─── Voice Synthesis Helper ───────────────────────────────────────────────────
// Uses Web Speech API (SpeechSynthesis) for text-to-speech output

let currentUtterance = null
let isSpeaking = false

export function isVoiceSupported() {
  return typeof window !== "undefined" && ("speechSynthesis" in window || "webkitSpeechSynthesis" in window)
}

export function getVoiceStatus() {
  return isSpeaking
}

export function stopVoice() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel()
    isSpeaking = false
    currentUtterance = null
  }
}

export function speakText(text, options = {}) {
  if (!isVoiceSupported()) {
    console.warn("Speech Synthesis not supported")
    return false
  }

  // Stop any ongoing speech
  stopVoice()

  // Clean text: remove citations for cleaner audio output
  const cleanText = text
    .replace(/\[BCRA\s*•[^\]]+\]/g, "")
    .replace(/\n+/g, " ")
    .trim()

  if (!cleanText) return false

  const {
    language = "en-US",
    rate = 1.0,
    pitch = 1.0,
    volume = 1.0,
    onStart = null,
    onEnd = null,
    onError = null,
  } = options

  const utterance = new SpeechSynthesisUtterance(cleanText)
  utterance.lang = language
  utterance.rate = Math.max(0.5, Math.min(2, rate))
  utterance.pitch = Math.max(0.5, Math.min(2, pitch))
  utterance.volume = Math.max(0, Math.min(1, volume))

  utterance.onstart = () => {
    isSpeaking = true
    if (onStart) onStart()
  }

  utterance.onend = () => {
    isSpeaking = false
    currentUtterance = null
    if (onEnd) onEnd()
  }

  utterance.onerror = (event) => {
    isSpeaking = false
    currentUtterance = null
    console.error("Speech synthesis error:", event.error)
    if (onError) onError(event.error)
  }

  currentUtterance = utterance
  window.speechSynthesis.speak(utterance)
  return true
}

export function getAvailableVoices() {
  if (!isVoiceSupported()) return []
  return window.speechSynthesis.getVoices()
}

export function setVoice(utterance, voiceIndex) {
  const voices = getAvailableVoices()
  if (voices[voiceIndex]) {
    utterance.voice = voices[voiceIndex]
  }
}

export function pauseVoice() {
  if (window.speechSynthesis && window.speechSynthesis.paused === false) {
    window.speechSynthesis.pause()
  }
}

export function resumeVoice() {
  if (window.speechSynthesis && window.speechSynthesis.paused === true) {
    window.speechSynthesis.resume()
  }
}
