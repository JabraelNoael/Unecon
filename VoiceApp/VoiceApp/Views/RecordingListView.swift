import SwiftUI

struct RecordingListView: View {
    @StateObject private var store = RecordingsStore()
    @StateObject private var recorder = AudioRecorderService()

    @State private var pendingRecording: Recording?
    @State private var pendingURL: URL?
    @State private var permissionDenied = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                RecordButtonView(recorder: recorder, onStart: startRecording, onStop: stopRecording)
                    .padding(.vertical, 8)

                Divider()

                List {
                    ForEach(store.recordings) { recording in
                        NavigationLink(value: recording) {
                            RecordingRow(recording: recording)
                        }
                    }
                    .onDelete { indexSet in
                        indexSet.map { store.recordings[$0] }.forEach(store.delete)
                    }
                }
                .listStyle(.plain)
                .overlay {
                    if store.recordings.isEmpty {
                        ContentUnavailableView("No Recordings Yet", systemImage: "waveform",
                                                description: Text("Tap the red button to start."))
                    }
                }
            }
            .navigationTitle("Recordings")
            .navigationDestination(for: Recording.self) { recording in
                RecordingDetailView(recording: recording, store: store)
            }
            .alert("Microphone access needed", isPresented: $permissionDenied) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Enable microphone access in Settings to record.")
            }
        }
    }

    private func startRecording() {
        Task {
            guard await recorder.requestPermission() else {
                permissionDenied = true
                return
            }
            let (recording, url) = store.beginNewRecording(title: "Recording \(store.recordings.count + 1)")
            pendingRecording = recording
            pendingURL = url
            try? recorder.start(to: url)
        }
    }

    private func stopRecording() {
        let duration = recorder.stop()
        guard let pendingRecording else { return }
        store.finishRecording(pendingRecording, duration: duration)
        self.pendingRecording = nil
        self.pendingURL = nil
    }
}

private struct RecordingRow: View {
    let recording: Recording

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(recording.title).font(.headline)
            HStack {
                Text(recording.createdAt, style: .date)
                Text(recording.createdAt, style: .time)
                Spacer()
                Text(formattedDuration)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var formattedDuration: String {
        let total = Int(recording.duration)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
