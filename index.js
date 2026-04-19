const savedServerUrl =
  localStorage.getItem("cloud9_serverUrl") ||
  sessionStorage.getItem("cloud9_serverUrl") ||
  "https://marc-widespread-lisa-enhanced.trycloudflare.com";

let SERVER_URL = normalizeBaseUrl(savedServerUrl);

let files = [];
let activity = [];
let serverOnline = false;
let usedStorageGb = 0;
const totalStorageGb = 500;

function normalizeBaseUrl(url) {
  let value = (url || "").trim();

  if (!value) return "";

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  return value.replace(/\/+$/, "");
}

function isHttpsPage() {
  return window.location.protocol === "https:";
}

function isHttpApi(url) {
  return /^http:\/\//i.test(url);
}

function explainNetworkError(serverUrl, err) {
  if (isHttpsPage() && isHttpApi(serverUrl)) {
    return "blocked: github pages is https but your backend is http. use a public https backend or open the site locally on the same network.";
  }

  if (err && err.message) {
    return `load failed: ${err.message}`;
  }

  return "backend not reachable";
}

function getStoredValue(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
}

function setStoredValue(key, value, remember) {
  if (remember) {
    localStorage.setItem(key, value);
    sessionStorage.removeItem(key);
  } else {
    sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  }
}

function clearStoredValue(key) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

function getAuthHeader() {
  const username = getStoredValue("cloud9_username");
  const password = getStoredValue("cloud9_password");

  if (!username && !password) return null;
  return "Basic " + btoa(`${username}:${password}`);
}

function addAuthHeaders(headers = {}) {
  const auth = getAuthHeader();
  if (auth) headers["Authorization"] = auth;
  return headers;
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/* ---------------- LOGIN PAGE ---------------- */

(function initLoginPage() {
  const loginForm = document.getElementById("loginForm");
  const message = document.getElementById("message");

  if (!loginForm || !message) return;

  window.addEventListener("load", () => {
    const serverUrlField = document.getElementById("serverUrl");
    const usernameField = document.getElementById("username");
    const passwordField = document.getElementById("password");
    const rememberMeField = document.getElementById("rememberMe");

    const savedUrl =
      getStoredValue("cloud9_serverUrl") ||
      "https://marc-widespread-lisa-enhanced.trycloudflare.com";
    const savedUsername = getStoredValue("cloud9_username");
    const savedPassword = getStoredValue("cloud9_password");

    if (serverUrlField) serverUrlField.value = savedUrl;
    if (usernameField && savedUsername) usernameField.value = savedUsername;
    if (passwordField && savedPassword) passwordField.value = savedPassword;
    if (rememberMeField && localStorage.getItem("cloud9_username")) {
      rememberMeField.checked = true;
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const serverUrlField = document.getElementById("serverUrl");
    const usernameField = document.getElementById("username");
    const passwordField = document.getElementById("password");
    const rememberMeField = document.getElementById("rememberMe");

    const serverUrl = normalizeBaseUrl(
      serverUrlField ? serverUrlField.value : SERVER_URL
    );
    const username = usernameField ? usernameField.value.trim() : "";
    const password = passwordField ? passwordField.value : "";
    const rememberMe = rememberMeField ? rememberMeField.checked : false;

    message.textContent = "checking login...";
    message.className = "message";
    message.style.color = "#9fb0e0";

    if (!serverUrl) {
      message.textContent = "enter a backend url";
      message.className = "message error";
      message.style.color = "#ff6b6b";
      return;
    }

    if (!username || !password) {
      message.textContent = "enter username and password";
      message.className = "message error";
      message.style.color = "#ff6b6b";
      return;
    }

    if (isHttpsPage() && isHttpApi(serverUrl)) {
      message.textContent =
        "this page is https but your backend is http. iphone/safari will usually block that.";
      message.className = "message error";
      message.style.color = "#ff6b6b";
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
      });

      const data = await safeJson(res);

      if (!res.ok || !data.success) {
        throw new Error(data.message || `login failed (${res.status})`);
      }

      setStoredValue("cloud9_serverUrl", serverUrl, rememberMe);
      setStoredValue("cloud9_username", username, rememberMe);
      setStoredValue("cloud9_password", password, rememberMe);

      SERVER_URL = serverUrl;

      message.textContent = "login successful. redirecting...";
      message.className = "message success";
      message.style.color = "#3ddc97";

      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 700);
    } catch (error) {
      message.textContent = explainNetworkError(serverUrl, error);
      message.className = "message error";
      message.style.color = "#ff6b6b";
      console.error("login error:", error);
    }
  });
})();

/* ---------------- DASHBOARD PAGE ---------------- */

(function initDashboardPage() {
  const dashboardRoot =
    document.getElementById("view-dashboard") ||
    document.getElementById("dashboardFilesList") ||
    document.getElementById("fullFilesList");

  if (!dashboardRoot) return;

  SERVER_URL = normalizeBaseUrl(getStoredValue("cloud9_serverUrl") || SERVER_URL);

  const views = {
    dashboard: document.getElementById("view-dashboard"),
    files: document.getElementById("view-files"),
    activity: document.getElementById("view-activity"),
    settings: document.getElementById("view-settings")
  };

  const navButtons = document.querySelectorAll(".nav-btn");
  const dashboardFilesList = document.getElementById("dashboardFilesList");
  const fullFilesList = document.getElementById("fullFilesList");
  const dashboardActivityList = document.getElementById("dashboardActivityList");
  const fullActivityList = document.getElementById("fullActivityList");
  const fileSearch = document.getElementById("fileSearch");
  const fileTypeFilter = document.getElementById("fileTypeFilter");
  const globalSearch = document.getElementById("globalSearch");

  function switchView(viewName) {
    Object.entries(views).forEach(([name, section]) => {
      if (section) section.classList.toggle("hidden", name !== viewName);
    });

    navButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
  }

  function renderStorage() {
    const percent =
      totalStorageGb > 0 ? Math.round((usedStorageGb / totalStorageGb) * 100) : 0;

    const storagePercentLabel = document.getElementById("storagePercentLabel");
    const usedStorage = document.getElementById("usedStorage");
    const totalStorage = document.getElementById("totalStorage");
    const storageFill = document.getElementById("storageFill");

    if (storagePercentLabel) storagePercentLabel.textContent = percent + "%";
    if (usedStorage) usedStorage.textContent = usedStorageGb + " GB";
    if (totalStorage) totalStorage.textContent = totalStorageGb + " GB";
    if (storageFill) storageFill.style.width = percent + "%";
  }

  function fileCard(file) {
    return `
      <div class="file-item">
        <div class="file-icon">${file.icon || "📄"}</div>
        <div>
          <div class="file-name">${file.name}</div>
          <div class="small-muted">${file.size || "unknown"} • updated ${file.updated || "recently"}</div>
          <div><span class="tag">${file.type || "File"}</span></div>
        </div>
        <div class="file-actions">
          <button onclick="downloadFile('${file.path}')">Download</button>
          <button onclick="deleteFile('${file.path}')">Delete</button>
        </div>
      </div>
    `;
  }

  function activityCard(item) {
    return `
      <div class="activity-item">
        <div>${item.text}</div>
        <div class="activity-time">${item.time}</div>
      </div>
    `;
  }

  function renderFiles() {
    const text = (
      (fileSearch && fileSearch.value) ||
      (globalSearch && globalSearch.value) ||
      ""
    ).toLowerCase();

    const type = fileTypeFilter ? fileTypeFilter.value : "all";

    const filtered = files.filter((file) => {
      const matchesText =
        file.name.toLowerCase().includes(text) ||
        (file.type || "").toLowerCase().includes(text);

      const matchesType = type === "all" || file.type === type;
      return matchesText && matchesType;
    });

    if (dashboardFilesList) {
      dashboardFilesList.innerHTML =
        filtered.slice(0, 3).map(fileCard).join("") ||
        `<div class="small-muted">No files found.</div>`;
    }

    if (fullFilesList) {
      fullFilesList.innerHTML =
        filtered.map(fileCard).join("") ||
        `<div class="small-muted">No files found.</div>`;
    }

    const metricFiles = document.getElementById("metricFiles");
    if (metricFiles) metricFiles.textContent = files.length;
  }

  function renderActivity() {
    if (dashboardActivityList) {
      dashboardActivityList.innerHTML =
        activity.slice(0, 4).map(activityCard).join("") ||
        `<div class="small-muted">No activity yet.</div>`;
    }

    if (fullActivityList) {
      fullActivityList.innerHTML =
        activity.map(activityCard).join("") ||
        `<div class="small-muted">No activity yet.</div>`;
    }
  }

  function addActivity(text, time = "just now") {
    activity.unshift({ text, time });
    renderActivity();
  }

  function formatBytes(bytes) {
    if (bytes == null) return "unknown";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function guessType(name, isDir = false) {
    if (isDir) return "Folder";
    const parts = name.split(".");
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : "";

    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "Image";
    if (["mp4", "mov", "mkv", "webm"].includes(ext)) return "Video";
    if (["js", "py", "html", "css", "json", "java", "cpp"].includes(ext)) return "Code";
    if (["pdf", "doc", "docx", "txt", "md", "pptx"].includes(ext)) return "Document";
    if (["zip", "tar", "gz"].includes(ext)) return "Archive";

    return "File";
  }

  function guessIcon(type) {
    if (type === "Folder") return "📁";
    if (type === "Image") return "🖼️";
    if (type === "Video") return "🎥";
    if (type === "Code") return "🧠";
    if (type === "Archive") return "💾";
    return "📄";
  }

  async function checkServer() {
    if (!SERVER_URL) {
      addActivity("No server URL saved");
      return false;
    }

    if (isHttpsPage() && isHttpApi(SERVER_URL)) {
      const serverStatusText = document.getElementById("serverStatusText");
      const serverSubtext = document.getElementById("serverSubtext");
      const statusMain = document.getElementById("statusMain");

      if (serverStatusText) serverStatusText.textContent = "Blocked";
      if (serverSubtext) serverSubtext.textContent = "HTTPS frontend cannot call HTTP backend";
      if (statusMain) statusMain.textContent = "Blocked";

      addActivity("Blocked: HTTPS frontend cannot call HTTP backend");
      return false;
    }

    try {
      const res = await fetch(`${SERVER_URL}/api/health`, {
        headers: addAuthHeaders()
      });

      const data = await safeJson(res);

      if (!res.ok) {
        throw new Error(data.error || `health check failed (${res.status})`);
      }

      serverOnline = true;

      const serverStatusText = document.getElementById("serverStatusText");
      const serverSubtext = document.getElementById("serverSubtext");
      const statusMain = document.getElementById("statusMain");

      if (serverStatusText) serverStatusText.textContent = "Online";
      if (serverSubtext) serverSubtext.textContent = data.base_dir || SERVER_URL;
      if (statusMain) statusMain.textContent = "Healthy";

      addActivity("Connected to Raspberry Pi server");
      return true;
    } catch (err) {
      serverOnline = false;

      const serverStatusText = document.getElementById("serverStatusText");
      const serverSubtext = document.getElementById("serverSubtext");
      const statusMain = document.getElementById("statusMain");

      if (serverStatusText) serverStatusText.textContent = "Offline";
      if (serverSubtext) serverSubtext.textContent = explainNetworkError(SERVER_URL, err);
      if (statusMain) statusMain.textContent = "Offline";

      addActivity("Could not connect to Raspberry Pi server");
      console.error("checkServer error:", err);
      return false;
    }
  }

  async function loadFiles(path = "") {
    try {
      const res = await fetch(`${SERVER_URL}/api/files?path=${encodeURIComponent(path)}`, {
        headers: addAuthHeaders()
      });

      const data = await safeJson(res);

      if (!res.ok) {
        throw new Error(data.error || `list failed (${res.status})`);
      }

      const items = Array.isArray(data.items) ? data.items : [];
      files = items.map((item) => {
        const type = guessType(item.name, item.is_dir);
        return {
          id: item.path,
          path: item.path,
          name: item.name,
          type,
          size: item.is_dir ? "Folder" : formatBytes(item.size),
          updated: "live",
          icon: guessIcon(type)
        };
      });

      usedStorageGb = Math.min(totalStorageGb, Math.round(files.length * 2));
      renderFiles();
      renderStorage();
      addActivity(`Loaded ${files.length} items from server`);
    } catch (err) {
      files = [];
      renderFiles();
      addActivity(`Failed to load files: ${err.message}`);
      console.error("loadFiles error:", err);
    }
  }

  async function downloadFile(path) {
    try {
      const auth = getAuthHeader();
      const url = new URL(`${SERVER_URL}/api/download`);
      url.searchParams.set("path", path);

      const res = await fetch(url.toString(), {
        headers: auth ? { Authorization: auth } : {}
      });

      if (!res.ok) throw new Error(`download failed (${res.status})`);

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = path.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);

      addActivity(`Started download for ${path}`);
    } catch (err) {
      addActivity(`Download failed for ${path}`);
      console.error("download error:", err);
    }
  }

  async function deleteFile(path) {
    try {
      const res = await fetch(`${SERVER_URL}/api/delete`, {
        method: "POST",
        headers: addAuthHeaders({
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({ path })
      });

      const data = await safeJson(res);

      if (!res.ok) throw new Error(data.error || `delete failed (${res.status})`);

      addActivity(`Deleted ${path}`);
      await loadFiles();
    } catch (err) {
      addActivity(`Delete failed for ${path}`);
      console.error("delete error:", err);
    }
  }

  async function uploadSampleFile() {
    const blob = new Blob(["hello from cloud 9"], { type: "text/plain" });
    const formData = new FormData();
    formData.append("path", "");
    formData.append("file", blob, `sample_${Date.now()}.txt`);

    try {
      const res = await fetch(`${SERVER_URL}/api/upload`, {
        method: "POST",
        headers: addAuthHeaders(),
        body: formData
      });

      const data = await safeJson(res);

      if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);

      addActivity("Uploaded sample file");
      await loadFiles();
    } catch (err) {
      addActivity(`Upload failed: ${err.message}`);
      console.error("upload error:", err);
    }
  }

  function clearActivity() {
    activity = [];
    renderActivity();
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  const openFilesViewBtn = document.getElementById("openFilesViewBtn");
  const addSampleFileBtn = document.getElementById("addSampleFileBtn");
  const uploadBtn = document.getElementById("uploadBtn");
  const quickUploadBtn = document.getElementById("quickUploadBtn");
  const heroUploadBtn = document.getElementById("heroUploadBtn");
  const clearActivityBtn = document.getElementById("clearActivityBtn");
  const toggleServerBtn = document.getElementById("toggleServerBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");

  if (openFilesViewBtn) openFilesViewBtn.addEventListener("click", () => switchView("files"));
  if (addSampleFileBtn) addSampleFileBtn.addEventListener("click", uploadSampleFile);
  if (uploadBtn) uploadBtn.addEventListener("click", uploadSampleFile);
  if (quickUploadBtn) quickUploadBtn.addEventListener("click", uploadSampleFile);
  if (heroUploadBtn) heroUploadBtn.addEventListener("click", uploadSampleFile);
  if (clearActivityBtn) clearActivityBtn.addEventListener("click", clearActivity);

  if (toggleServerBtn) {
    toggleServerBtn.addEventListener("click", async () => {
      await checkServer();
      if (serverOnline) await loadFiles();
    });
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      const serverIp = document.getElementById("serverIp");
      if (!serverIp) return;

      const input = serverIp.value.trim();
      if (!input) return;

      SERVER_URL = normalizeBaseUrl(input);

      localStorage.setItem("cloud9_serverUrl", SERVER_URL);
      sessionStorage.setItem("cloud9_serverUrl", SERVER_URL);

      addActivity(`Server URL updated to ${SERVER_URL}`);
      alert(`server url saved as ${SERVER_URL}`);
    });
  }

  if (fileSearch) fileSearch.addEventListener("input", renderFiles);
  if (fileTypeFilter) fileTypeFilter.addEventListener("change", renderFiles);
  if (globalSearch) globalSearch.addEventListener("input", renderFiles);

  renderStorage();
  renderFiles();
  renderActivity();

  window.downloadFile = downloadFile;
  window.deleteFile = deleteFile;

  (async function init() {
    const ok = await checkServer();
    if (ok) await loadFiles();
  })();
})();