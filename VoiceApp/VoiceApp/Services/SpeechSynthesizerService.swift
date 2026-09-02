import Foundation
import AVFoundation

/// TTS via AVSpeechSynthesizer. Picking an "enhanced"/"premium" quality
/// voice (downloaded via Settings > Accessibility > Spoken Content > Voices)
/// is what separates natural-sounding output from the classic robotic
/// default voice — the API is identical either way, quality is just a
/// matter of which voice identifier you pick.
@MainActor
final class SpeechSynthesizerService: NSObject, ObservableObject {
    @Published private(set) var isSpeaking = false

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// Best available English voice: prefers Enhanced/Premium quality if the
    /// user has downloaded one, falls back to the default system voice.
    static func bestAvailableVoice(languagePrefix: String = "en") -> AVSpeechSynthesisVoice? {
        let candidates = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix(languagePrefix) }

        if let premium = candidates.first(where: { $0.quality == .premium }) {
            return premium
        }
        if let enhanced = candidates.first(where: { $0.quality == .enhanced }) {
            return enhanced
        }
        return AVSpeechSynthesisVoice(language: "en-US")
    }

    func speak(_ text: String, rate: Float = AVSpeechUtteranceDefaultSpeechRate) {
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = Self.bestAvailableVoice()
        utterance.rate = rate
        utterance.pitchMultiplier = 1.0
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }
}

extension SpeechSynthesizerService: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Task { @MainActor in isSpeaking = true }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in isSpeaking = false }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in isSpeaking = false }
    }
}
