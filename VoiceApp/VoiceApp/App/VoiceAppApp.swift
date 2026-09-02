import SwiftUI

@main
struct VoiceAppApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                RecordingListView()
                    .tabItem { Label("Recordings", systemImage: "waveform") }

                TTSDemoView()
                    .tabItem { Label("TTS Demo", systemImage: "speaker.wave.2") }
            }
        }
    }
}
