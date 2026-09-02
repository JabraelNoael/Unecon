import Foundation

/// One voice memo. Mirrors the `models/{VERSION}/` pattern from ML work:
/// each recording gets its own folder holding the raw audio plus any
/// derived artifacts (transcript, diarization, flags) as separate files,
/// so adding a new derived artifact later never touches the audio file.
struct Recording: Identifiable, Codable, Hashable {
    let id: UUID
    var createdAt: Date
    var duration: TimeInterval
    var title: String

    /// Folder name on disk: Documents/Recordings/<id>/
    var folderName: String { id.uuidString }
}

struct Transcript: Codable, Equatable {
    var text: String
    var generatedAt: Date
    var engine: String // e.g. "apple-speech-on-device", later "whisper-cpp"
}
