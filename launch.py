"""Open an existing local builder, or start it and open its interface."""
import json
import sys
import webbrowser
from urllib.request import ProxyHandler, build_opener


def main():
    address = "http://127.0.0.1:8766"
    try:
        response = build_opener(ProxyHandler({})).open(address + "/api/health", timeout=1)
        if json.load(response).get("app") == "chamber-studio":
            webbrowser.open(address)
            return
    except (OSError, ValueError):
        pass
    from server import main as serve
    sys.argv = ["server.py", "--open"]
    serve()


if __name__ == "__main__":
    main()
