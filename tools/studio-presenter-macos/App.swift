import AppKit
import WebKit

func trustedAudience(_ url: URL?) -> Bool {
    guard let url else { return false }
    return url.scheme == "https" && url.host == "riteshk.work" && (url.port == nil || url.port == 443)
}

@MainActor
final class PresenterApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private var audience: WKWebView!
    private var pad: WKWebView!
    private var audienceWindow: NSWindow!
    private var panel: NSPanel!
    private var current: [String: Any]?
    private var ready = false
    private var active = false
    private var ownsFullscreen = false
    private var snapshotBusy = false
    private var generation = 0
    private var timer: Timer?
    private let preferenceKeys = ["rk:presenter:split", "rk:presenter:notes-size"]

    func applicationDidFinishLaunching(_ notification: Notification) {
        let warning = NSAlert()
        warning.messageText = "macOS Developer Preview"
        warning.informativeText = "Capture privacy is unverified. Share ONLY the audience window, never the whole display. Confirm the outgoing feed and recordings before using private notes. Media controls remain in the audience window."
        warning.addButton(withTitle: "Continue")
        warning.addButton(withTitle: "Quit")
        guard warning.runModal() == .alertFirstButtonReturn else { NSApp.terminate(nil); return }
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Studio Presenter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let openItem = NSMenuItem(title: "Open", action: nil, keyEquivalent: "")
        let openMenu = NSMenu()
        openMenu.addItem(withTitle: "Content Studio", action: #selector(openContent), keyEquivalent: "1").target = self
        openMenu.addItem(withTitle: "Slide Studio", action: #selector(openSlides), keyEquivalent: "2").target = self
        openItem.submenu = openMenu; menu.addItem(openItem); NSApp.mainMenu = menu
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "presenter")
        configuration.userContentController.addUserScript(WKUserScript(source: """
        if(window===window.top){
          window.__RK_NATIVE_PRESENTER=true;
          const events=new EventTarget();
          events.postMessage=message=>window.webkit.messageHandlers.presenter.postMessage(message);
          window.chrome=window.chrome||{};window.chrome.webview=events;
          window.receiveNative=message=>events.dispatchEvent(new MessageEvent('message',{data:message}));
        }
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        audience = WKWebView(frame: .zero, configuration: configuration)
        audience.navigationDelegate = self; audience.uiDelegate = self
        audienceWindow = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        audienceWindow.title = "Studio Presenter - Audience"
        audienceWindow.contentView = audience; audienceWindow.delegate = self
        audienceWindow.center(); audienceWindow.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        openContent()
    }

    @objc private func openContent() { open("/studio/") }
    @objc private func openSlides() { open("/studio/slide-merge-lab/") }
    private func open(_ path: String) { end(); audience.load(URLRequest(url: URL(string: "https://riteshk.work" + path)!)) }

    private func start() {
        active = true; generation += 1
        if panel == nil {
            let configuration = WKWebViewConfiguration()
            configuration.userContentController.add(self, name: "presenter")
            pad = WKWebView(frame: .zero, configuration: configuration)
            pad.navigationDelegate = self; pad.uiDelegate = self
            panel = NSPanel(contentRect: NSRect(x: 60, y: 60, width: 960, height: 720), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            panel.title = "Presenter DJ pad - macOS Preview"
            panel.contentView = pad; panel.delegate = self; panel.level = .floating
            panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            guard let url = Bundle.main.url(forResource: "companion", withExtension: "html") else { end(); return }
            pad.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        if !audienceWindow.styleMask.contains(.fullScreen) { ownsFullscreen = true; audienceWindow.toggleFullScreen(nil) }
        panel.makeKeyAndOrderFront(nil)
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.snapshot() }
        }
    }

    private func send(_ message: [String: Any], to webView: WKWebView, function: String) {
        guard JSONSerialization.isValidJSONObject(message), let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.\(function)?.(\(json))", completionHandler: nil)
    }

    private func command(_ payload: [String: Any]) {
        guard active else { return }
        var message = payload; message["channel"] = "rk-presenter"
        send(message, to: audience, function: "receiveNative")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let payload = message.body as? [String: Any], let type = payload["type"] as? String else { return }
        if message.webView === audience {
            guard trustedAudience(message.frameInfo.request.url), payload["channel"] as? String == "rk-presenter" else { return }
            if type == "end" { end(); return }
            guard type == "state" else { return }
            current = payload
            if !active { start() }
            if ready { send(payload, to: pad, function: "receivePresenter") }
        } else if message.webView === pad {
            if type == "ready" {
                ready = true
                let values = Dictionary(uniqueKeysWithValues: preferenceKeys.map { ($0, UserDefaults.standard.string(forKey: $0) ?? "") })
                send(["type": "preferences", "values": values], to: pad, function: "receivePresenter")
                if let current, active { send(current, to: pad, function: "receivePresenter") }
            } else if type == "preference", let key = payload["key"] as? String, preferenceKeys.contains(key), let raw = payload["value"] as? String, let value = Double(raw), value.isFinite {
                let bounded = key == preferenceKeys[0] ? min(75, max(40, value)) : min(32, max(14, value))
                UserDefaults.standard.set(String(bounded), forKey: key)
            } else if type == "command", let action = payload["command"] as? String {
                if ["prev", "next", "exit", "timer-reset", "timer-pause", "pointer-leave"].contains(action) { command(["command": action]) }
                else if action == "jump", let index = payload["index"] as? Int { command(["command": action, "index": index]) }
                else if action == "edit", let index = payload["index"] as? Int, let key = payload["key"] as? String, ["notes", "durationMinutes"].contains(key), let value = payload["value"] { command(["command": action, "index": index, "key": key, "value": value]) }
            } else if type == "pointer", let x = payload["x"] as? Double, let y = payload["y"] as? Double, x.isFinite, y.isFinite, let current {
                command(["command": "pointer", "x": (current["left"] as? Double ?? 0) + min(1, max(0, x)) * (current["width"] as? Double ?? 0), "y": (current["top"] as? Double ?? 0) + min(1, max(0, y)) * (current["height"] as? Double ?? 0)])
            }
        }
    }

    private func snapshot() {
        guard active, ready, !snapshotBusy, !audienceWindow.isMiniaturized, let current else { return }
        let rect = NSRect(x: current["left"] as? Double ?? 0, y: current["top"] as? Double ?? 0, width: current["width"] as? Double ?? 0, height: current["height"] as? Double ?? 0).intersection(audience.bounds)
        guard !rect.isEmpty else { return }
        let configuration = WKSnapshotConfiguration(); configuration.rect = rect; configuration.snapshotWidth = 960
        let requestedGeneration = generation; snapshotBusy = true
        audience.takeSnapshot(with: configuration) { [weak self] image, _ in
            guard let self else { return }
            self.snapshotBusy = false
            guard self.active, self.generation == requestedGeneration else { return }
            guard let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) else {
                self.send(["type": "snapshot-error"], to: self.pad, function: "receivePresenter"); return
            }
            self.send(["type": "snapshot", "image": "data:image/png;base64," + png.base64EncodedString()], to: self.pad, function: "receivePresenter")
        }
    }

    private func end() {
        active = false; current = nil; generation += 1; timer?.invalidate(); timer = nil
        panel?.orderOut(nil)
        if let pad { pad.evaluateJavaScript("document.querySelector('[data-pp-notes]').value='';document.querySelector('[data-pp-now] img').removeAttribute('src')", completionHandler: nil) }
        if ownsFullscreen, audienceWindow.styleMask.contains(.fullScreen) { audienceWindow.toggleFullScreen(nil) }
        ownsFullscreen = false
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === panel { command(["command": "exit"]); end(); return false }
        end(); NSApp.terminate(nil); return true
    }
    func applicationWillTerminate(_ notification: Notification) { end() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { end() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
        if webView === audience {
            if trustedAudience(navigationAction.request.url) { if active { end() }; decisionHandler(.allow) }
            else { decisionHandler(.cancel) }
        } else {
            let url = navigationAction.request.url
            decisionHandler(url?.isFileURL == true && url?.lastPathComponent == "companion.html" || url?.absoluteString == "about:blank" ? .allow : .cancel)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if webView === audience, let url = navigationAction.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }
}

if CommandLine.arguments.contains("--check-policy") {
    precondition(trustedAudience(URL(string: "https://riteshk.work/studio/")))
    precondition(!trustedAudience(URL(string: "https://riteshk.work.evil.example/")))
    precondition(!trustedAudience(URL(string: "http://riteshk.work/")))
    precondition(!trustedAudience(URL(string: "https://riteshk.work:444/")))
    print("Origin policy checks passed. Screen-sharing privacy is NOT verified.")
} else {
    let application = NSApplication.shared
    let delegate = PresenterApp()
    application.delegate = delegate
    application.setActivationPolicy(.regular)
    application.run()
}