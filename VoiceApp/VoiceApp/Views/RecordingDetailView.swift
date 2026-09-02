import SwiftUI
import AVFoundation

struct RecordingDetailView: View {
    let recording: Recording
    @ObservedObject var store: RecordingsStore

    @State private var player: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var transcript: Transcript?
    @State private var isTranscribing = false
    @State private var errorMessage: String?

    private let transcriber = AppleSpeechTranscriber()

    var body: some View {
        Form {
            Section("Playback") {
                Button {
                    togglePlayback()
                } label: {
                    Label(isPlaying ? "Pause" : "Play", systemImage: isPlaying ? "pause.fill" : "play.fill")
                }
            }

            Section("Transcript") {
                if let transcript {
                    Text(transcript.text)
                    Text("via \(transcript.engine)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if isTranscribing {
                    HStack { ProgressView(); Text("Transcribing on-device…") }
                } else {
                    Button("Transcribe") { runTranscription() }
                }

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).font(.caption)
                }
            }
        }
        .navigationTitle(recording.title)
        .onAppear {
            transcript = store.loadTranscript(for: recording)
        }
    }

    private func togglePlayback() {
        if isPlaying {
            player?.pause()
            isPlaying = false
            return
        }
        if player == nil {
            player = try? AVAudioPlayer(contentsOf: store.audioURL(for: recording))
        }
        player?.play()
        isPlaying = true
    }

    private func runTranscription() {
        isTranscribing = true
        errorMessage = nil
        Task {
            guard await transcriber.requestAuthorization() else {
                await MainActor.run {
                    errorMessage = "Speech recognition permission denied."
                    isTranscribing = false
                }
                return
            }
            do {
                let text = try await transcriber.transcribe(fileURL: store.audioURL(for: recording))
                let result = Transcript(text: text, generatedAt: Date(), engine: "apple-speech-on-device")
                await MainActor.run {
                    transcript = result
                    store.saveTranscript(result, for: recording)
                    isTranscribing = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isTranscribing = false
                }
            }
        }
    }
}
