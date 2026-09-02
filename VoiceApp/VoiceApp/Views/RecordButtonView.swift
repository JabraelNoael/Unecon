import SwiftUI

/// Just the record/pause/resume/stop control + live timer + level meter.
/// Pulled out of RecordingListView so the recording UI can be reused
/// (e.g. in a modal sheet) without dragging the list along with it.
struct RecordButtonView: View {
    @ObservedObject var recorder: AudioRecorderService
    var onStart: () -> Void
    var onStop: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(formattedElapsed)
                .font(.system(.title, design: .monospaced))
                .contentTransition(.numericText())
                .animation(.default, value: recorder.elapsed)

            levelMeter

            HStack(spacing: 32) {
                if recorder.state != .idle {
                    Button {
                        recorder.state == .recording ? recorder.pause() : recorder.resume()
                    } label: {
                        Image(systemName: recorder.state == .recording ? "pause.fill" : "play.fill")
                            .font(.title2)
                            .frame(width: 56, height: 56)
                            .background(.thinMaterial, in: Circle())
                    }
                }

                Button {
                    recorder.state == .idle ? onStart() : onStop()
                } label: {
                    ZStack {
                        Circle()
                            .fill(recorder.state == .idle ? Color.red : Color.red.opacity(0.85))
                            .frame(width: 72, height: 72)
                        if recorder.state != .idle {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(.white)
                                .frame(width: 26, height: 26)
                        }
                    }
                }
                .animation(.easeInOut(duration: 0.15), value: recorder.state)
            }
        }
        .padding()
    }

    private var levelMeter: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.red.opacity(0.7))
            .frame(width: max(4, CGFloat(recorder.meterLevel) * 200), height: 8)
            .frame(width: 200, alignment: .leading)
            .animation(.linear(duration: 0.05), value: recorder.meterLevel)
    }

    private var formattedElapsed: String {
        let total = Int(recorder.elapsed)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
