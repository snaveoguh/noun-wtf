import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = UIColor(red: 0x0d / 255.0, green: 0x11 / 255.0, blue: 0x17 / 255.0, alpha: 1)
        window?.rootViewController = GameViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Capacitor's bridge view controller with the full-screen tweaks a landscape
/// game wants. Orientation itself is locked in Info.plist
/// (UISupportedInterfaceOrientations); this only covers what the plist can't.
final class GameViewController: CAPBridgeViewController {
    override var prefersStatusBarHidden: Bool { true }

    /// Fade the home indicator while playing; it comes back on a tap near
    /// the bottom edge.
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    /// The touch sticks sit near the screen edges: require a second swipe
    /// before iOS opens Control Center / the notification shade.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x0d / 255.0, green: 0x11 / 255.0, blue: 0x17 / 255.0, alpha: 1)
        webView?.backgroundColor = view.backgroundColor
        webView?.isOpaque = false
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }
}
