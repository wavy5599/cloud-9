from flask import Flask, request, jsonify, send_file
from pathlib import Path
import os
import shutil

app = Flask(__name__)

# change this to whatever folder you want exposed
BASE_DIR = Path.home() / "cloud9_storage"
BASE_DIR.mkdir(parents=True, exist_ok=True)


def safe_path(relative_path: str) -> Path:
    """
    Prevent path traversal so users can't escape BASE_DIR.
    """
    target = (BASE_DIR / relative_path).resolve()
    if BASE_DIR.resolve() not in [target, *target.parents]:
        raise ValueError("invalid path")
    return target


def file_info(path: Path) -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path.relative_to(BASE_DIR)),
        "is_dir": path.is_dir(),
        "size": stat.st_size if path.is_file() else None
    }


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "base_dir": str(BASE_DIR)
    })


@app.route("/api/list", methods=["GET"])
def list_files():
    rel = request.args.get("path", "").strip()
    try:
        current = safe_path(rel)
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    if not current.exists():
        return jsonify({"error": "path does not exist"}), 404
    if not current.is_dir():
        return jsonify({"error": "path is not a directory"}), 400

    items = [file_info(item) for item in sorted(current.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))]

    return jsonify({
        "current_path": str(current.relative_to(BASE_DIR)),
        "items": items
    })


@app.route("/api/download", methods=["GET"])
def download_file():
    rel = request.args.get("path", "").strip()
    try:
        target = safe_path(rel)
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    if not target.exists() or not target.is_file():
        return jsonify({"error": "file not found"}), 404

    return send_file(target, as_attachment=True)


@app.route("/api/upload", methods=["POST"])
def upload_file():
    rel = request.form.get("path", "").strip()
    uploaded = request.files.get("file")

    if not uploaded:
        return jsonify({"error": "no file uploaded"}), 400

    try:
        target_dir = safe_path(rel)
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    target_dir.mkdir(parents=True, exist_ok=True)

    filename = Path(uploaded.filename).name
    save_path = target_dir / filename
    uploaded.save(save_path)

    return jsonify({
        "message": "upload complete",
        "file": file_info(save_path)
    })


@app.route("/api/mkdir", methods=["POST"])
def make_dir():
    data = request.get_json(silent=True) or {}
    rel = data.get("path", "").strip()
    folder_name = data.get("name", "").strip()

    if not folder_name:
        return jsonify({"error": "folder name required"}), 400

    try:
        parent = safe_path(rel)
        new_dir = safe_path(str(Path(rel) / folder_name))
    except ValueError:
        return jsonify({"error": "invalid path"}), 400

    parent.mkdir(parents=True, exist_ok=True)
    new_dir.mkdir(parents=True, exist_ok=True)

    return jsonify({
        "message": "folder created",
        "folder": file_info(new_dir)
    })


@app.route("/api/delete", methods=["POST"])
def delete_item():
    data = request.get_json(silent=True) or {}
    rel = data.get("path", "").strip()

    try:
        target = safe_path(rel)
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