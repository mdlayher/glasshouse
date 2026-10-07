# System tools & logs

The **Tools** tab, `/?tab=tools`, provides a live system log inspection terminal for power users and developers to inspect system activity, service telemetry, and hardware diagnostics directly from the browser without requiring SSH.

### Log sources

* **System (`/var/log/messages`)**: webOS system daemon logs written by PmLogDaemon, tracking system services (e.g. `sam`, `audiooutputd`, `pqcontroller`, `fancontroller`).
* **Glasshouse (`/var/lib/tvweb/tvweb.log`)**: Output from the Glasshouse background server, stamped with monotonic uptime for sub-millisecond chronological interleaving.
* **Kernel (`dmesg`)**: Linux kernel ring buffer, covering device drivers, thermal alerts, USB events, and network interfaces.

### Inspection features

* **Multi-source interleaving**: Merges lines from selected sources into a single unified timeline based on monotonic seconds since boot.
* **Filtering & search**: Instant search with match highlighting, plus severity level filters (All, Errors, Warnings, Info). Clicking the Error or Warning summary counters toggles that filter immediately.
* **Live streaming & pause**: Real-time polling with a live pulsing indicator, automatically suspended when the browser tab is hidden to conserve TV resources.
* **Inspector drawer**: Clicking any log line expands detailed metadata and renders pretty-printed, syntax-highlighted JSON for structured webOS event payloads.
* **Export & copy**: One-click copying to clipboard and timestamped `.txt` file download for diagnostics and bug reporting.

![Tools tab: system uptime and loaded entry counters, source toggles, real-time search, live status, and terminal log viewer](../screenshots/tools.png)

*Live webOS system logs, Glasshouse daemon events, and kernel ring buffer diagnostics.*
