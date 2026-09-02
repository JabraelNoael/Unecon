import Foundation

/// Owns the on-disk layout for recordings. Nothing else in the app touches
/// the filesystem directly — same reasoning as keeping weights/, logs/,
/// and configs/ separated in an ML run: one place knows the layout, so it
/// can change without every caller needing to know.
///
/// Layout:
///   Documents/Recordings/<uuid>/
///     audio.m4a
///     meta.json        (Recording, minus the derived stuff)
///     transcript.json   (Transcript, optional — absent until transcribed)
final class RecordingsStore: ObservableObject {
    @Published private(set) var recordings: [Recording] = []

    private let root: URL

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        root = docs.appendingPathComponent("Recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        reload()
    }

    func folderURL(for recording: Recording) -> URL {
        root.appendingPathComponent(recording.folderName, isDirectory: true)
    }

    func audioURL(for recording: Recording) -> URL {
        folderURL(for: recording).appendingPathComponent("audio.m4a")
    }

    private func metaURL(for recording: Recording) -> URL {
        folderURL(for: recording).appendingPathComponent("meta.json")
    }

    private func transcriptURL(for recording: Recording) -> URL {
        folderURL(for: recording).appendingPathComponent("transcript.json")
    }

    /// Reserves a folder + audio destination URL for a brand-new recording.
    /// Caller (AudioRecorderService) writes audio to the returned URL as it records.
    func beginNewRecording(title: String = "Untitled") -> (Recording, URL) {
        let recording = Recording(id: UUID(), createdAt: Date(), duration: 0, title: title)
        let folder = folderURL(for: recording)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return (recording, audioURL(for: recording))
    }

    func finishRecording(_ recording: Recording, duration: TimeInterval) {
        var finished = recording
        finished.duration = duration
        save(finished)
        reload()
    }

    func save(_ recording: Recording) {
        guard let data = try? JSONEncoder().encode(recording) else { return }
        try? data.write(to: metaURL(for: recording))
    }

    func delete(_ recording: Recording) {
        try? FileManager.default.removeItem(at: folderURL(for: recording))
        reload()
    }

    func loadTranscript(for recording: Recording) -> Transcript? {
        guard let data = try? Data(contentsOf: transcriptURL(for: recording)) else { return nil }
        return try? JSONDecoder().decode(Transcript.self, from: data)
    }

    func saveTranscript(_ transcript: Transcript, for recording: Recording) {
        guard let data = try? JSONEncoder().encode(transcript) else { return }
        try? data.write(to: transcriptURL(for: recording))
    }

    func reload() {
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        recordings = folders.compactMap { folder -> Recording? in
            let metaURL = folder.appendingPathComponent("meta.json")
            guard let data = try? Data(contentsOf: metaURL) else { return nil }
            return try? JSONDecoder().decode(Recording.self, from: data)
        }
        .sorted { $0.createdAt > $1.createdAt }
    }
}
