import SwiftUI

/// Standalone playground for text -> speech, decoupled from the recording
/// flow so you can iterate on voice quality/rate without touching the
/// recorder. Once an LLM is wired in later, its output just gets piped into
/// SpeechSynthesizerService.speak(_:) — this screen is what proves that call
/// sounds right before anything is generating the text.
struct TTSDemoView: View {
    @StateObject private var speech = SpeechSynthesizerService()
    @State private var text = "Hey, this is a quick test of what the on-device voice actually sounds like."
    @State private var rate: Float = 0.5 // AVSpeechUtteranceDefaultSpeechRate is 0.5

    var body: some View {
        NavigationStack {
            Form {
                Section("Text") {
                    TextEditor(text: $text)
                        .frame(minHeight: 120)
                }

                Section("Rate") {
                    Slider(value: $rate, in: 0.3...0.6)
                }

                Section {
                    Button {
                        speech.isSpeaking ? speech.stop() : speech.speak(text, rate: rate)
                    } label: {
                        Label(speech.isSpeaking ? "Stop" : "Speak", systemImage: speech.isSpeaking ? "stop.fill" : "speaker.wave.2.fill")
                    }
                }

                Section("Voice being used") {
                    if let voice = SpeechSynthesizerService.bestAvailableVoice() {
                        Text("\(voice.name) — \(voice.quality == .premium ? "Premium" : voice.quality == .enhanced ? "Enhanced" : "Default")")
                        if voice.quality == .default {
                            Text("Download an Enhanced/Premium voice in Settings > Accessibility > Spoken Content > Voices for a less robotic sound.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("TTS Demo")
        }
    }
}
