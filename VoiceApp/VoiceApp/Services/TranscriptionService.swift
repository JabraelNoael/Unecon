import Foundation
import Speech

/// Swappable transcription backend. AppleSpeechTranscriber implements this
/// today; a WhisperCppTranscriber can implement the same protocol later
/// (e.g. once diarization is needed) without any caller changing.
protocol TranscriptionService {
    func transcribe(fileURL: URL) async throws -> String
}

enum TranscriptionError: Error {
    case notAuthorized
    case recognizerUnavailable
}

final class AppleSpeechTranscriber: TranscriptionService {
    func requestAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    func transcribe(fileURL: URL) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else {
            throw TranscriptionError.recognizerUnavailable
        }

        let request = SFSpeechURLRecognitionRequest(url: fileURL)
        request.requiresOnDeviceRecognition = true // keeps it free, offline, private

        return try await withCheckedThrowingContinuation { continuation in
            var didResume = false
            recognizer.recognitionTask(with: request) { result, error in
                if let error, !didResume {
                    didResume = true
                    continuation.resume(throwing: error)
                    return
                }
                if let result, result.isFinal, !didResume {
                    didResume = true
                    continuation.resume(returning: result.bestTranscription.formattedString)
                }
            }
        }
    }
}
