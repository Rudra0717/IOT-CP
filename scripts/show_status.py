import urllib.request
import socket
import time
import sys

SERVICES = [
    {
        "service": "Frontend Web Laboratory",
        "endpoint": "http://localhost:3000",
        "desc": "Virtual EV Fleet Grid & Interactive Deep Inspector",
        "type": "http"
    },
    {
        "service": "FastAPI Backend",
        "endpoint": "http://localhost:8000/api/health",
        "desc": "Telemetry processing, SQLite DB, Anomaly engine",
        "type": "http"
    },
    {
        "service": "Interactive API Docs (Swagger)",
        "endpoint": "http://localhost:8000/docs",
        "desc": "Full API exploration & testing",
        "type": "http"
    },
    {
        "service": "Simulator Control API",
        "endpoint": "http://localhost:8001/status",
        "desc": "Edge telemetry orchestrator & physics engine",
        "type": "http"
    },
    {
        "service": "MQTT Broker (Mosquitto)",
        "endpoint": "localhost:1883 / ws:9001",
        "desc": "Real-time IoT message broker",
        "type": "mqtt"
    }
]

def check_service(s):
    if s["type"] == "http":
        try:
            req = urllib.request.Request(
                s["endpoint"],
                headers={"User-Agent": "EVSenseStatusCheck/1.0"}
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    return "HTTP 200 OK"
                return f"HTTP {resp.status}"
        except Exception:
            return "Starting..."
    elif s["type"] == "mqtt":
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            sock.connect(("127.0.0.1", 1883))
            sock.close()
            return "Healthy"
        except Exception:
            return "Connecting..."
    return "Unknown"

def main():
    # Allow services a moment if just brought up with docker compose up -d
    max_retries = 8
    statuses = {}
    
    for attempt in range(max_retries):
        all_ok = True
        for s in SERVICES:
            st = check_service(s)
            statuses[s["service"]] = st
            if "Starting" in st or "Connecting" in st:
                all_ok = False
        if all_ok or attempt == max_retries - 1:
            break
        time.sleep(1.0)

    # ANSI color helpers
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

    # Print the exact requested status table
    header_fmt = "{:<32} {:<38} {:<16} {}"
    row_fmt    = "{:<32} {:<38} {:<16} {}"

    print("\n" + "=" * 135)
    print(header_fmt.format("Service", "Endpoint", "Status", "Description"))
    print("-" * 135)

    for s in SERVICES:
        st = statuses.get(s["service"], "Unknown")
        st_padded = f"{st:<16}"
        if "200 OK" in st or "Healthy" in st:
            status_display = f"{GREEN}{st_padded}{RESET}"
        else:
            status_display = f"{YELLOW}{st_padded}{RESET}"

        print(row_fmt.format(
            s["service"],
            s["endpoint"],
            status_display,
            s["desc"]
        ))

    print("=" * 135 + "\n")

if __name__ == "__main__":
    main()
