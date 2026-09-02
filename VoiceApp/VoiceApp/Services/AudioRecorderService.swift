import Foundation
import AVFoundation

/// Wraps AVAudioRecorder. This is the one place that talks to AVAudioSession
/// and AVAudioRecorder — views only ever see @Published state, never the
/// underlying AV objects. Keeping this boundary tight is what makes the
/// recording engine swappable later (e.g. to AVAudioEngine for live
/// level-metering) without touching any UI code.
@MainActor
final class AudioRecorderService: ObservableObject {
    enum State: Equatable {
        case idle
        case recording
        case paused
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    /// 0...1 running average input level, for driving a waveform/meter view.
    @Published private(set) var meterLevel: Float = 0

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var startedAt: Date?
    private var accumulated: TimeInterval = 0

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start(to url: URL) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try session.setActive(true)

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        recorder.record()
        self.recorder = recorder
        accumulated = 0
        startedAt = Date()
        state = .recording
        startTimer()
    }

    func pause() {
        guard state == .recording else { return }
        recorder?.pause()
        accumulated += Date().timeIntervalSince(startedAt ?? Date())
        state = .paused
        stopTimer()
    }

    func resume() {
        guard state == .paused else { return }
        recorder?.record()
        startedAt = Date()
        state = .recording
        startTimer()
    }

    /// Returns final duration in seconds.
    @discardableResult
    func stop() -> TimeInterval {
        if state == .recording {
            accumulated += Date().timeIntervalSince(startedAt ?? Date())
        }
        recorder?.stop()
        recorder = nil
        stopTimer()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        state = .idle
        let duration = accumulated
        elapsed = 0
        accumulated = 0
        return duration
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        guard let startedAt else { return }
        elapsed = accumulated + Date().timeIntervalSince(startedAt)
        recorder?.updateMeters()
        if let db = recorder?.averagePower(forChannel: 0) {
            // Convert dBFS (-160...0) to a 0...1 level for UI.
            let normalized = max(0, (db + 50) / 50)
            meterLevel = meterLevel * 0.7 + normalized * 0.3 // smooth so the bar doesn't jitter
        }
    }
}
