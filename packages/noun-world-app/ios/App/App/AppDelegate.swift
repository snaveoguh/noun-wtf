import AVFoundation
import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Noun World is a game: keep the screen awake while it is in front.
        application.isIdleTimerDisabled = true
        configureAudioSession()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // The web layer pauses the sim on Capacitor's appStateChange
        // (see src/native.ts); nothing else to do here.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // A phone call / Siri / another app's audio can deactivate our session;
        // re-assert it so the radio and voice chat come back on resume.
        application.isIdleTimerDisabled = true
        configureAudioSession()
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    /// iOS audio unlock, native half.
    ///
    /// WKWebView starts with the `ambient` category: the game's music is
    /// silenced by the ring/silent switch and ducked by other apps. `.playback`
    /// routes the mix through the media channel regardless of the mute
    /// switch; `.mixWithOthers` keeps the user's own music running until the
    /// game actually plays something; `.allowBluetooth` + `.defaultToSpeaker`
    /// make voice chat (`getUserMedia`, which WebKit records through this same
    /// session) come out of the speaker / headset instead of the earpiece.
    /// The JS side still needs a user gesture to resume the AudioContext;
    /// src/native.ts handles that.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.mixWithOthers, .allowBluetooth, .defaultToSpeaker]
            )
            try session.setActive(true, options: [])
        } catch {
            // Fall back to plain playback (no mic routing) rather than leaving
            // the WebView on the ambient category.
            do {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try session.setActive(true, options: [])
            } catch {
                NSLog("[noun-world-app] AVAudioSession setup failed: \(error)")
            }
        }
    }
}
