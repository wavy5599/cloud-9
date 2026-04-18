from flask import Flask, request, jsonify, send_file, redirect
from flask_cors import CORS
from pathlib import Path
from werkzeug.utils import secure_filename
from functools import wraps
import shutil
import secrets
import socket
import platform
import subprocess

app = Flask(__name__)

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "https://wavy5599.github.io",
                "https://wavy5599.github.io/cloud-9",
            ]
        }
    }
)

# hardcoded login for now
API_USERNAME = "admin"
API_PASSWORD = "1234"

# storage folder
BASE_DIR = Path.home() / "cloud9_storage"
BASE_DIR.mkdir(parents=True, exist_ok=True)


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_pi_temp():
    # method 1: vcgencmd
    try:
        output = subprocess.check_output(
            ["vcgencmd", "measure_temp"],
            stderr=subprocess.DEVNULL
        ).decode().strip()

        return output.replace("temp=", "").replace("'C", "").strip()
    except Exception:
        pass

    # method 2: linux thermal file
    try:
        thermal_file = Path("/sys/class/thermal/thermal_zone0/temp")
        if thermal_file.exists():
            raw = thermal_file.read_text().strip()
            return str(round(int(raw) / 1000, 1))
    except Exception:
        pass

    return None


def safe_path(relative_path: str = "") -> Path:
    target = (BASE_DIR / relative_path).resolve()
    if BASE_DIR.resolve() not in [target, *target.parents]:
        raise ValueError("invalid path")
    return target


def file_info(path: Path) -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path.relative_to(BASE_DIR)),
        "type": "folder" if path.is_dir() else "file",
        "is_dir": path.is_dir(),
        "size": stat.st_size if path.is_file() else None
    }


def check_auth(username: str, password: str) -> bool:
    username_ok = secrets.compare_digest(username or "", API_USERNAME)
    password_ok = secrets.compare_digest(password or "", API_PASSWORD)
    return username_ok and password_ok


def unauthorized():
    return jsonify({"error": "unauthorized"}), 401


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.authorization
        if not auth or not check_auth(auth.username, auth.password):
            return unauthorized()
        return fn(*args, **kwargs)
    return wrapper


@app.route("/", methods=["GET"])
def home():
    return redirect("https://wavy5599.github.io/cloud-9/")


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    if check_auth(username, password):
        return jsonify({
            "success": True,
            "message": "login successful"
        })

    return jsonify({
        "success": False,
        "message": "invalid username or password"
    }), 401


@app.route("/api/health", methods=["GET"])
@require_auth
def health():
    return jsonify({
        "status": "ok",
        "authenticated": True,
        "base_dir": str(BASE_DIR)
    })


@app.route("/api/status", methods=["GET"])
@require_auth
def status():
    return jsonify({
        "online": True,
        "device_name": platform.node(),
        "system": f"{platform.system()} {platform.release()}",
        "pi_ip": get_local_ip(),
        "storage_path": str(BASE_DIR)
    })


@app.route("/api/pi-info", methods=["GET"])
@require_auth
def pi_info():
    temp_c = get_pi_temp()

    return jsonify({
        "hostname": platform.node(),
        "ip": get_local_ip(),
        "temperature_c": f"{temp_c} °C" if temp_c is not None else "unavailable",
        "system": f"{platform.system()} {platform.release()}",
        "storage_path": str(BASE_DIR)
    })


@app.route("/api/files", methods=["GET"])
@app.route("/api/list", methods=["GET"])
@require_auth
def list_files():
    rel_path = request.args.get("path", "").strip()

    try:
        folder = safe_path(rel_path)
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    if not folder.exists():
        return jsonify({"error": "path does not exist"}), 404

    if not folder.is_dir():
        return jsonify({"error": "path is not a directory"}), 400

    items = [
        file_info(item)
        for item in sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    ]

    current_path = ""
    if folder != BASE_DIR:
        current_path = str(folder.relative_to(BASE_DIR))

    return jsonify({
        "current_path": current_path,
        "items": items
    })


@app.route("/api/upload", methods=["POST"])
@require_auth
def upload_file():
    rel_path = request.form.get("path", "").strip()
    uploaded = request.files.get("file")

    if not uploaded:
        return jsonify({"error": "no file uploaded"}), 400

    if uploaded.filename == "":
        return jsonify({"error": "no selected file"}), 400

    try:
        target_dir = safe_path(rel_path)
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    if not target_dir.exists():
        target_dir.mkdir(parents=True, exist_ok=True)

    if not target_dir.is_dir():
        return jsonify({"error": "target path is not a folder"}), 400

    filename = secure_filename(uploaded.filename)
    if not filename:
        return jsonify({"error": "invalid filename"}), 400

    save_path = target_dir / filename
    uploaded.save(save_path)

    return jsonify({
        "message": "upload complete",
        "file": file_info(save_path)
    })


@app.route("/api/download", methods=["GET"])
@require_auth
def download_file():
    rel_path = request.args.get("path", "").strip()

    try:
        target = safe_path(rel_path)
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    if not target.exists() or not target.is_file():
        return jsonify({"error": "file not found"}), 404

    return send_file(target, as_attachment=True)


@app.route("/api/mkdir", methods=["POST"])
@require_auth
def make_dir():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()
    folder_name = data.get("name", "").strip()

    try:
        if folder_name:
            new_dir = safe_path(str(Path(rel_path) / folder_name))
        elif rel_path:
            new_dir = safe_path(rel_path)
        else:
            return jsonify({"error": "path or folder name required"}), 400
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    new_dir.mkdir(parents=True, exist_ok=True)

    return jsonify({
        "message": "folder created",
        "folder": file_info(new_dir)
    })


@app.route("/api/delete", methods=["POST"])
@require_auth
def delete_item():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()

    if not rel_path:
        return jsonify({"error": "path required"}), 400

    try:
        target = safe_path(rel_path)
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    if not target.exists():
        return jsonify({"error": "path not found"}), 404

    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()

    return jsonify({"message": "deleted"})


if __name__ == "__main__":
    print("cloud 9 backend starting...")
    print(f"login username: {API_USERNAME}")
    print(f"storage path: {BASE_DIR}")
    print(f"local ip: {get_local_ip()}")
    app.run(host="0.0.0.0", port=5000, debug=True)