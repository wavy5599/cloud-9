const SERVER_URL = "http://192.168.0.11:5000";

let files = [];
let activity = [];
let serverOnline = false;
let usedStorageGb = 0;
const totalStorageGb = 500;

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
    section.classList.toggle("hidden", name !== viewName);
  });

  navButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
}

function renderStorage() {
  const percent = totalStorageGb > 0
    ? Math.round((usedStorageGb / totalStorageGb) * 100)
    : 0;

  document.getElementById("storagePercentLabel").textContent = percent + "%";
  document.getElementById("usedStorage").textContent = usedStorageGb + " GB";
  document.getElementById("totalStorage").textContent = totalStorageGb + " GB";
  document.getElementById("storageFill").style.width = percent + "%";
}

const loginBtn = document.getElementById("loginBtn");



function fileCard(file) {
  return `
    <div class="file-item">
      <div class="file-icon">${file.icon || "📄"}</div>
      <div>
        <div class="file-name">${file.name}</div>
        <div class="small-muted">${file.size || "unknown"} • updated ${file.updated || "recently"}</div>
        <div>
          <span class="tag">${file.type || "File"}</span>
        </div>
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
  const text = (fileSearch.value || globalSearch.value || "").toLowerCase();
  const type = fileTypeFilter.value;

  const filtered = files.filter(file => {
    const matchesText =
      file.name.toLowerCase().includes(text) ||
      (file.type || "").toLowerCase().includes(text);

    const matchesType = type === "all" || file.type === type;

    return matchesText && matchesType;
  });

  dashboardFilesList.innerHTML =
    filtered.slice(0, 3).map(fileCard).join("") ||
    `<div class="small-muted">No files found.</div>`;

  fullFilesList.innerHTML =
    filtered.map(fileCard).join("") ||
    `<div class="small-muted">No files found.</div>`;

  document.getElementById("metricFiles").textContent = files.length;
}

function renderActivity() {
  dashboardActivityList.innerHTML =
    activity.slice(0, 4).map(activityCard).join("") ||
    `<div class="small-muted">No activity yet.</div>`;

  fullActivityList.innerHTML =
    activity.map(activityCard).join("") ||
    `<div class="small-muted">No activity yet.</div>`;
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
  const ext = name.split(".").pop().toLowerCase();

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
  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    if (!res.ok) throw new Error("health check failed");

    const data = await res.json();
    serverOnline = true;

    document.getElementById("serverStatusText").textContent = "Online";
    document.getElementById("serverSubtext").textContent = data.base_dir || "Raspberry Pi connected";
    document.getElementById("statusMain").textContent = "Healthy";

    addActivity("Connected to Raspberry Pi server");
    return true;
  } catch (err) {
    serverOnline = false;

    document.getElementById("serverStatusText").textContent = "Offline";
    document.getElementById("serverSubtext").textContent = "Could not reach Pi server";
    document.getElementById("statusMain").textContent = "Offline";

    addActivity("Could not connect to Raspberry Pi server");
    return false;
  }
}

async function loadFiles(path = "") {
  try {
    const res = await fetch(`${SERVER_URL}/api/list?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error("list failed");

    const data = await res.json();

    files = data.items.map(item => {
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
    addActivity("Failed to load files from server");
  }
}

async function downloadFile(path) {
  try {
    window.open(`${SERVER_URL}/api/download?path=${encodeURIComponent(path)}`, "_blank");
    addActivity(`Started download for ${path}`);
  } catch (err) {
    addActivity(`Download failed for ${path}`);
  }
}

async function deleteFile(path) {
  try {
    const res = await fetch(`${SERVER_URL}/api/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    });

    if (!res.ok) throw new Error("delete failed");

    addActivity(`Deleted ${path}`);
    await loadFiles();
  } catch (err) {
    addActivity(`Delete failed for ${path}`);
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
      body: formData
    });

    if (!res.ok) throw new Error("upload failed");

    addActivity("Uploaded sample file");
    await loadFiles();
  } catch (err) {
    addActivity("Upload failed");
  }
}

function clearActivity() {
  activity = [];
  renderActivity();
}

navButtons.forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("openFilesViewBtn").addEventListener("click", () => switchView("files"));
document.getElementById("addSampleFileBtn").addEventListener("click", uploadSampleFile);
document.getElementById("uploadBtn").addEventListener("click", uploadSampleFile);
document.getElementById("quickUploadBtn").addEventListener("click", uploadSampleFile);
document.getElementById("heroUploadBtn").addEventListener("click", uploadSampleFile);
document.getElementById("clearActivityBtn").addEventListener("click", clearActivity);

document.getElementById("toggleServerBtn").addEventListener("click", async () => {
  await checkServer();
  if (serverOnline) {
    await loadFiles();
  }
});

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const ip = document.getElementById("serverIp").value.trim();
  if (ip) {
    addActivity(`Server IP updated to ${ip}`);
    alert("You can now change SERVER_URL in your JS to: http://" + ip + ":5000");
  }
});

fileSearch.addEventListener("input", renderFiles);
fileTypeFilter.addEventListener("change", renderFiles);
globalSearch.addEventListener("input", renderFiles);

renderStorage();
renderFiles();
renderActivity();

window.downloadFile = downloadFile;
window.deleteFile = deleteFile;

(async function init() {
  const ok = await checkServer();
  if (ok) {
    await loadFiles();
  }
})();