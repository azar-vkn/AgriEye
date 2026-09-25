// Keyless voice for the agriculture agent using the browser's Web Speech
// API. God's Eye View's OpenAI Realtime voice needs a paid key, so AgriEye
// uses the browser's built-in recognizer where available (Chrome, Edge) and
// degrades to typed commands elsewhere.

export function createSpeech({ lang = 'en-IN', onResult, onState } = {}) {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const synth = globalThis.speechSynthesis;
  let recognition = null;
  let listening = false;
  let speakEnabled = false;

  function setState(state, detail) {
    listening = state === 'listening';
    onState?.(state, detail);
  }

  return Object.freeze({
    supported: Boolean(Recognition),
    canSpeak: Boolean(synth),
    isListening: () => listening,
    start() {
      if (!Recognition || listening) return;
      recognition = new Recognition();
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        const transcript = result[0].transcript.trim();
        onResult?.(transcript, result.isFinal);
      };
      recognition.onerror = (event) => setState('error', event.error);
      recognition.onend = () => {
        if (listening) setState('idle');
      };
      try {
        recognition.start();
        setState('listening');
      } catch (error) {
        setState('error', error.message);
      }
    },
    stop() {
      recognition?.stop();
      setState('idle');
    },
    setSpeakEnabled(enabled) {
      speakEnabled = Boolean(enabled && synth);
      if (!speakEnabled) synth?.cancel();
    },
    isSpeakEnabled: () => speakEnabled,
    speak(text) {
      if (!speakEnabled || !text) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(
        text.replace(/[•|]/g, ' ').replace(/\s+/g, ' ').slice(0, 600),
      );
      utterance.lang = lang;
      utterance.rate = 1.03;
      synth.speak(utterance);
    },
  });
}
