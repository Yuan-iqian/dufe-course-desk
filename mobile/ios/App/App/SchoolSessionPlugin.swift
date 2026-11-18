import Foundation
import UIKit
import WebKit
import Capacitor
import Security

class CourseBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SchoolSessionPlugin())
    }
}

@objc(SchoolSessionPlugin)
public class SchoolSessionPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate, WKScriptMessageHandler, UIAdaptivePresentationControllerDelegate {
    public let identifier = "SchoolSessionPlugin"
    public let jsName = "SchoolSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openCampusCard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeCampusCard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "settings", returnType: CAPPluginReturnPromise)
    ]
    private let origin = "https://ginkgostu.dufe.edu.cn"
    private var school: WKWebView?
    private var sheet: UINavigationController?
    private var loaded = false
    private var reader = ""
    private var pending: [String: CAPPluginCall] = [:]
    private var campusCard: UINavigationController?
    private var clearing = false

    @objc public func openCampusCard(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.clearing else { call.reject("正在退出学校，请稍后重试"); return }
            if self.campusCard != nil { call.resolve(); return }
            guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else {
                call.reject("请先返回应用，再打开校园码"); return
            }
            let page = CampusCardPage()
            page.onClose = { [weak self] in
                self?.campusCard = nil
                if self?.clearing == false { self?.notifyListeners("schoolSessionChanged", data: [:]) }
            }
            let navigation = UINavigationController(rootViewController: page)
            navigation.modalPresentationStyle = .fullScreen
            self.campusCard = navigation
            presenter.present(navigation, animated: true) { call.resolve() }
        }
    }
    private func dismissCampusCard() {
        (campusCard?.viewControllers.first as? CampusCardPage)?.stop()
        campusCard?.dismiss(animated: false)
        campusCard = nil
    }
    @objc public func closeCampusCard(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.dismissCampusCard(); call.resolve() }
    }
    @objc public func reconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.clearing && self.sheet == nil else { call.resolve(["started": false]); return }
            do {
                try self.ensureSchool()
                self.loaded = false
                SchoolLoginMemory.shared.restore { [weak self] in
                    guard let self = self, !self.clearing else { call.resolve(["started": false]); return }
                    self.school?.load(URLRequest(url: URL(string: self.origin + "/")!))
                    call.resolve(["started": true])
                }
            } catch { call.resolve(["started": false]) }
        }
    }

    private func allowedSchool(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return url.scheme == "https" && (host == "dufe.edu.cn" || host.hasSuffix(".dufe.edu.cn")) && url.user == nil && url.password == nil && (url.port == nil || url.port == 443)
    }
    private func exactSchool() -> Bool {
        guard let url = school?.url else { return false }
        return allowedSchool(url) && url.host == "ginkgostu.dufe.edu.cn"
    }
    private func ensureSchool() throws {
        if clearing { throw NSError(domain: "CourseDesk", code: 2, userInfo: [NSLocalizedDescriptionKey: "正在退出学校，请稍后重试"]) }
        if school != nil { return }
        guard let file = Bundle.main.url(forResource: "school-request", withExtension: "js", subdirectory: "public") else {
            throw NSError(domain: "CourseDesk", code: 1, userInfo: [NSLocalizedDescriptionKey: "学校读取组件缺失，请重新安装"])
        }
        reader = try String(contentsOf: file, encoding: .utf8)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(self, name: "CourseSchoolResult")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = true
        school = view
        SchoolLoginMemory.shared.restore { [weak self, weak view] in
            guard let self = self, let view = view, self.school === view, !self.clearing else { return }
            view.load(URLRequest(url: URL(string: self.origin + "/")!))
        }
    }

    @objc public func open(_ call: CAPPluginCall) {
        guard let url = URL(string: call.getString("url") ?? origin), allowedSchool(url) else { call.reject("只能打开学校的 HTTPS 页面"); return }
        DispatchQueue.main.async {
            do {
                try self.ensureSchool()
                if self.sheet != nil { call.resolve(); return }
                guard let school = self.school, let presenter = self.bridge?.viewController else { call.reject("无法打开学校窗口"); return }
                school.removeFromSuperview()
                let page = UIViewController()
                page.view.backgroundColor = .systemBackground
                page.title = "学校官方页面"
                page.navigationItem.rightBarButtonItem = UIBarButtonItem(title: "返回应用", style: .done, target: self, action: #selector(self.closeSchool))
                page.view.addSubview(school)
                school.translatesAutoresizingMaskIntoConstraints = false
                NSLayoutConstraint.activate([
                    school.topAnchor.constraint(equalTo: page.view.safeAreaLayoutGuide.topAnchor),
                    school.bottomAnchor.constraint(equalTo: page.view.safeAreaLayoutGuide.bottomAnchor),
                    school.leadingAnchor.constraint(equalTo: page.view.leadingAnchor),
                    school.trailingAnchor.constraint(equalTo: page.view.trailingAnchor)
                ])
                let navigation = UINavigationController(rootViewController: page)
                navigation.modalPresentationStyle = .fullScreen
                self.sheet = navigation
                navigation.presentationController?.delegate = self
                presenter.present(navigation, animated: true)
                if url.absoluteString != self.origin && url.absoluteString != self.origin + "/" {
                    SchoolLoginMemory.shared.restore { [weak self, weak school] in
                        guard let self = self, let school = school, self.school === school, !self.clearing else { return }
                        school.load(URLRequest(url: url))
                    }
                }
                call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc private func closeSchool() {
        sheet?.dismiss(animated: true) { [weak self] in self?.school?.removeFromSuperview(); self?.sheet = nil; self?.notifyListeners("schoolPageReady", data: [:]) }
    }
    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        school?.removeFromSuperview(); sheet = nil
        notifyListeners("schoolPageReady", data: [:])
    }
    private func allowedRequest(_ path: String, _ method: String) -> Bool {
        let methods = ["/student/currentDate": "GET", "/student/queryCourseList": "GET", "/student/HomeworkList": "GET", "/student/signIn/getStuSignInList": "POST", "/student/signIn/getSignInInfo": "POST", "/student/signIn/getOnlineSignInInfo": "POST", "/student/getWeekTimePaper": "POST"]
        return methods[path] == method
    }
    @objc public func request(_ call: CAPPluginCall) {
        guard allowedRequest(call.getString("path") ?? "", call.getString("method") ?? "") else { call.reject("不支持的学校读取操作"); return }
        DispatchQueue.main.async {
            do {
                try self.ensureSchool()
                let id = UUID().uuidString
                self.pending[id] = call
                DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.pending.removeValue(forKey: id)?.resolve(["error": "network"]) }
                self.runRequest(id, call)
            } catch { call.reject(error.localizedDescription) }
        }
    }
    private func runRequest(_ id: String, _ call: CAPPluginCall) {
        guard pending[id] != nil else { return }
        if !loaded {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.runRequest(id, call) }
            return
        }
        guard exactSchool() else { pending.removeValue(forKey: id)?.resolve(["error": "auth"]); return }
        do {
            let arguments: [String: Any] = ["path": call.getString("path") ?? "", "method": call.getString("method") ?? "", "params": call.getObject("params") ?? [:]]
            let bytes = try JSONSerialization.data(withJSONObject: arguments)
            let json = String(decoding: bytes, as: UTF8.self)
            let script = reader + "(" + json + ").then(result => window.webkit.messageHandlers.CourseSchoolResult.postMessage({requestId:'" + id + "',result}))"
            school?.evaluateJavaScript(script) { [weak self] _, error in
                if error != nil { self?.pending.removeValue(forKey: id)?.resolve(["error": "network"]) }
            }
        } catch { pending.removeValue(forKey: id)?.reject("无法读取学校数据") }
    }
    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let source = message.frameInfo.securityOrigin
        guard message.name == "CourseSchoolResult", message.frameInfo.isMainFrame, source.protocol == "https", source.host == "ginkgostu.dufe.edu.cn", (source.port == 0 || source.port == 443), exactSchool(),
              let body = message.body as? [String: Any], let id = body["requestId"] as? String, let result = body["result"] as? [String: Any] else { return }
        pending.removeValue(forKey: id)?.resolve(result)
    }
    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loaded = false }
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if exactSchool() { notifyListeners("schoolPageReady", data: [:]) }
    }
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, allowedSchool(url) else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request); decisionHandler(.cancel) }
        else { decisionHandler(.allow) }
    }
    @objc public func logout(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.clearing = true
            let forgotten = SchoolLoginMemory.shared.forget()
            self.dismissCampusCard()
            for waiting in self.pending.values { waiting.resolve(["error": "auth"]) }
            self.pending.removeAll()
            self.sheet?.dismiss(animated: false); self.sheet = nil
            self.school?.stopLoading()
            self.school?.configuration.userContentController.removeScriptMessageHandler(forName: "CourseSchoolResult")
            self.school?.removeFromSuperview(); self.school = nil; self.loaded = false
            let store = WKWebsiteDataStore.default()
            let types = WKWebsiteDataStore.allWebsiteDataTypes()
            store.fetchDataRecords(ofTypes: types) { records in
                let schoolRecords = records.filter { $0.displayName == "dufe.edu.cn" || $0.displayName.hasSuffix(".dufe.edu.cn") }
                store.removeData(ofTypes: types, for: schoolRecords) {
                    SchoolLoginMemory.shared.resume()
                    self.clearing = false
                    if forgotten { call.resolve() } else { call.reject("登录记忆清理失败，请解锁手机后再次退出账号") }
                }
            }
        }
    }
    @objc public func openExternal(_ call: CAPPluginCall) {
        guard let url = URL(string: call.getString("url") ?? ""), let host = url.host, ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil, (host == "dufe.edu.cn" || host.hasSuffix(".dufe.edu.cn") || host == "mp.weixin.qq.com") else { call.reject("无效的学校来源地址"); return }
        DispatchQueue.main.async { UIApplication.shared.open(url, options: [:]) { ok in if ok { call.resolve() } else { call.reject("无法打开来源页面") } } }
    }
    @objc public func settings(_ call: CAPPluginCall) {
        DispatchQueue.main.async { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!, options: [:]) { _ in call.resolve() } }
    }
}

// Keeps the official card and its login separate from the background course reader.
private final class CampusCardPage: UIViewController, WKNavigationDelegate {
    static let entry = URL(string: "https://sso.dufe.edu.cn/app.php/open_apps/person_card/index/index")!
    var onClose: (() -> Void)?
    private var web: WKWebView!
    private let status = UILabel()
    private var timeout: DispatchWorkItem?
    private var suspended = false
    private var failed = false
    private var stopped = false

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "我的校园码"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "返回应用", style: .done, target: self, action: #selector(closePage))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "刷新", style: .plain, target: self, action: #selector(reload))
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = .systemBackground
        view.addSubview(web)
        web.translatesAutoresizingMaskIntoConstraints = false
        let source = UILabel()
        source.text = "学校官方页面 · sso.dufe.edu.cn"
        source.textAlignment = .center
        source.font = .preferredFont(forTextStyle: .caption1)
        source.textColor = .secondaryLabel
        view.addSubview(source)
        source.translatesAutoresizingMaskIntoConstraints = false
        status.numberOfLines = 0
        status.textAlignment = .center
        status.textColor = .secondaryLabel
        status.font = .preferredFont(forTextStyle: .body)
        view.addSubview(status)
        status.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            source.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            source.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            source.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            source.heightAnchor.constraint(equalToConstant: 30),
            web.topAnchor.constraint(equalTo: source.bottomAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            status.centerYAnchor.constraint(equalTo: web.centerYAnchor),
            status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(suspendCard), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resumeCard), name: UIApplication.didBecomeActiveNotification, object: nil)
        SchoolLoginMemory.shared.restore { [weak self] in self?.reload() }
    }
    private func allowed(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return url.scheme == "https" && url.user == nil && url.password == nil && (url.port == nil || url.port == 443) && (host == "dufe.edu.cn" || host.hasSuffix(".dufe.edu.cn"))
    }
    private func loading() {
        guard !stopped else { return }
        failed = false
        web.isHidden = true
        status.text = "正在连接学校…"
        status.isHidden = false
        timeout?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.fail() }
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: work)
    }
    private func fail() {
        guard !stopped && !suspended else { return }
        failed = true
        timeout?.cancel()
        web.stopLoading()
        web.isHidden = true
        status.text = "学校页面暂时无法打开\n请检查网络后点击右上角刷新"
        status.isHidden = false
    }
    @objc private func reload() {
        guard !stopped else { return }
        loading()
        web.load(URLRequest(url: Self.entry, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25))
    }
    @objc private func suspendCard() {
        guard !stopped else { return }
        suspended = true
        timeout?.cancel()
        web.stopLoading()
        web.isHidden = true
        status.text = "返回后重新连接学校"
        status.isHidden = false
    }
    @objc private func resumeCard() {
        if suspended && !stopped { suspended = false; reload() }
    }
    func stop() {
        stopped = true
        timeout?.cancel()
        web?.stopLoading()
        web?.isHidden = true
        web?.navigationDelegate = nil
        NotificationCenter.default.removeObserver(self)
    }
    @objc private func closePage() {
        stop()
        dismiss(animated: true) { [weak self] in self?.onClose?() }
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !stopped && !suspended && !failed else { return }
        timeout?.cancel()
        status.isHidden = true
        web.isHidden = false
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { fail() }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { fail() }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { fail() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, allowed(url) else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request); decisionHandler(.cancel) }
        else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
            decisionHandler(.cancel); fail()
        } else { decisionHandler(.allow) }
    }
    deinit { timeout?.cancel(); NotificationCenter.default.removeObserver(self) }
}

// The device-only Keychain keeps session cookies across complete app restarts.
private final class SchoolLoginMemory: NSObject, WKHTTPCookieStoreObserver {
    static let shared = SchoolLoginMemory()
    private let store = WKWebsiteDataStore.default().httpCookieStore
    private let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "cn.dufe.coursedesk.school-login", kSecAttrAccount as String: "v1"]
    private var ready = false
    private var restoring = false
    private var paused = false
    private var generation = 0
    private var saveRevision = 0
    private var waiters: [() -> Void] = []
    private var scheduled: DispatchWorkItem?
    override init() {
        super.init()
        store.add(self)
        NotificationCenter.default.addObserver(self, selector: #selector(save), name: UIApplication.willResignActiveNotification, object: nil)
    }
    private func schoolCookie(_ cookie: HTTPCookie) -> Bool {
        let host = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return (host == "dufe.edu.cn" || host.hasSuffix(".dufe.edu.cn")) && (cookie.expiresDate == nil || cookie.expiresDate! > Date())
    }
    private func identity(_ cookie: HTTPCookie) -> String { cookie.domain + "\n" + cookie.path + "\n" + cookie.name }
    private func finishRestore() {
        ready = true; restoring = false
        let callbacks = waiters; waiters.removeAll()
        for callback in callbacks { callback() }
    }
    func restore(_ done: @escaping () -> Void) {
        if ready { done(); return }
        waiters.append(done)
        if restoring { return }
        restoring = true
        var read = query
        read[kSecReturnData as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(read as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let rows = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [[String: Any]] else {
            finishRestore(); return
        }
        let epoch = generation
        store.getAllCookies { [weak self] live in
            guard let self = self, self.generation == epoch, !self.paused else { return }
            let keys = Set(live.map { self.identity($0) })
            let group = DispatchGroup()
            for row in rows.prefix(200) {
                let properties = Dictionary(uniqueKeysWithValues: row.map { (HTTPCookiePropertyKey(rawValue: $0.key), $0.value) })
                guard let cookie = HTTPCookie(properties: properties), self.schoolCookie(cookie), cookie.isSessionOnly, !keys.contains(self.identity(cookie)) else { continue }
                group.enter(); self.store.setCookie(cookie) { group.leave() }
            }
            group.notify(queue: .main) { [weak self] in
                guard let self = self, self.generation == epoch, !self.paused else { return }
                self.finishRestore(); self.save()
            }
        }
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        if !ready || paused { return }
        scheduled?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.save() }
        scheduled = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
    }
    @objc private func save() {
        guard ready && !paused else { return }
        scheduled?.cancel()
        let epoch = generation
        saveRevision += 1
        let revision = saveRevision
        store.getAllCookies { [weak self] cookies in
            guard let self = self, self.generation == epoch, self.saveRevision == revision, !self.paused else { return }
            let rows: [[String: Any]] = cookies.filter { self.schoolCookie($0) && $0.isSessionOnly }.map { cookie in
                var row: [String: Any] = [:]
                for (key, value) in cookie.properties ?? [:] {
                    if let url = value as? URL { row[key.rawValue] = url.absoluteString }
                    else if value is String || value is NSNumber || value is Date { row[key.rawValue] = value }
                }
                return row
            }
            if rows.isEmpty { SecItemDelete(self.query as CFDictionary); return }
            guard let data = try? PropertyListSerialization.data(fromPropertyList: rows, format: .binary, options: 0) else { return }
            let update = [kSecValueData as String: data]
            let status = SecItemUpdate(self.query as CFDictionary, update as CFDictionary)
            if status == errSecItemNotFound {
                var item = self.query
                item[kSecValueData as String] = data
                item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                SecItemAdd(item as CFDictionary, nil)
            }
        }
    }
    func forget() -> Bool {
        generation += 1; paused = true; scheduled?.cancel()
        let result = SecItemDelete(query as CFDictionary)
        finishRestore()
        return result == errSecSuccess || result == errSecItemNotFound
    }
    func resume() { paused = false }
}

