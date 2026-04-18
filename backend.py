from flask import Flask, request, jsonify, send_file, redirect
from flask_cors import CORS
from pathlib import Path
from werkzeug.utils import secure_filename
import shutil

app = Flask(__name__)

# allow requests from your github pages frontend
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": ["https://wavy5599.github.io"]
        }
    }
)

# folder the server will expose
BASE_DIR = Path.home() / "cloud9_storage"
BASE_DIR.mkdir(parents=True, exist_ok=True)


def safe_path(relative_path: str = "") -> Path:
    """
    Resolve a relative path safely inside BASE_DIR.
    Prevent path traversal like ../../etc/passwd
    """
    target = (BASE_DIR / relative_path).resolve()
    if BASE_DIR.resolve() not in [target, *target.parents]:
        raise ValueError("invalid path")
    return target


def file_info(path: Path) -> dict:
    """
    Return file/folder metadata for the frontend
    """
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path.relative_to(BASE_DIR)),
        "type": "folder" if path.is_dir() else "file",
        "is_dir": path.is_dir(),
        "size": stat.st_size if path.is_file() else None
    }


@app.route("/", methods=["GET"])
def home():
    return redirect("https://wavy5599.github.io/cloud-9/")


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "base_dir": str(BASE_DIR)
    })


@app.route("/api/files", methods=["GET"])
@app.route("/api/list", methods=["GET"])
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

    target_dir.mkdir(parents=True, exist_ok=True)

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
def make_dir():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()
    folder_name = data.get("name", "").strip()

    # supports either:
    # {"path": "parent", "name": "newfolder"}
    # or {"path": "parent/newfolder"}
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
    app.run(host="0.0.0.0", port=5000, debug=True)