import os
from pathlib import Path


def read_secret(name: str, fallback: str = "") -> str:
    """Read a Docker secret or fall back to environment variable or default."""
    secret_path = Path(f"/run/secrets/{name}")
    try:
        if secret_path.exists():
            return secret_path.read_text(encoding="utf-8").strip()
    except Exception:
        pass
    env_name = name.upper()
    return os.environ.get(env_name, fallback).strip()


# Database configuration
DB_HOST = read_secret("db_host", os.environ.get("DB_HOST", "localhost"))
DB_PORT = int(read_secret("db_port", os.environ.get("DB_PORT", "5432")))
DB_NAME = read_secret("surveyqa_db_name", os.environ.get("DB_NAME", "injtech_surveyqa_db"))
DB_USER = read_secret("surveyqa_db_user", os.environ.get("DB_USER", "injtech_surveyqa_admin"))
DB_PASSWORD = read_secret("surveyqa_db_password", os.environ.get("DB_PASSWORD", ""))

# Redis configuration
REDIS_HOST = read_secret("redis_host", os.environ.get("REDIS_HOST", "localhost"))
REDIS_PORT = int(read_secret("redis_port", os.environ.get("REDIS_PORT", "6379")))
REDIS_PASSWORD = (
    read_secret("redis_password_secret")
    or read_secret("redis_password")
    or os.environ.get("REDIS_PASSWORD", "")
)

# OpenRouter / AI API Key
OPENROUTER_API_KEY = (
    read_secret("openrouter_synthfield")
    or read_secret("openrouter_api_key")
    or os.environ.get("OPENROUTER_API_KEY", "")
)

get_secret = read_secret

# Decodo Residential Proxy Credentials
DECODO_USER_RAW = read_secret("decodo_proxy_user", os.environ.get("DECODO_USER", ""))
DECODO_PASS = read_secret("decodo_proxy_pass", os.environ.get("DECODO_PASS", ""))
DECODO_USER = DECODO_USER_RAW.replace("-sessionduration-", "").strip() if DECODO_USER_RAW else ""
DECODO_USERNAME = DECODO_USER
DECODO_PASSWORD = DECODO_PASS

# File Storage Directories
SCREENSHOTS_DIR = os.environ.get("SCREENSHOTS_DIR", "/app/screenshots" if os.name != "nt" else "./screenshots")
TRACES_DIR = os.environ.get("TRACES_DIR", "/app/traces" if os.name != "nt" else "./traces")

# Ensure directories exist
Path(SCREENSHOTS_DIR).mkdir(parents=True, exist_ok=True)
Path(TRACES_DIR).mkdir(parents=True, exist_ok=True)
