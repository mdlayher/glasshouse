# Prometheus

The server can answer Prometheus scrapes at `/api/prometheus/metrics`, in the text exposition format. It is off by default, and while it is off the path does not exist: a request gets 404.

## Switching it on

Set it in `/var/lib/tvweb/config.json` on the TV and restart the server:

```json
"prometheus": { "enabled": true }
```

## Scraping

The endpoint is under `/api/`, so a [token](SECURITY.md), where one is set, is needed as for the rest of the API. Prometheus sends it as an `Authorization: Bearer` header, which keeps it out of URLs and logs:

```yaml
scrape_configs:
  - job_name: glasshouse
    metrics_path: /api/prometheus/metrics
    scrape_interval: 15s
    authorization:
      credentials_file: /etc/prometheus/glasshouse-token
    static_configs:
      - targets: ["192.168.1.20:8080"]
```

Each scrape runs the same stats collection as the dashboard, behind its 1.5 s cache, so 15 s is the recommended minimum scrape interval. At that rate it costs about the same as the MQTT bridge's 10 s publish.

## Testing locally

To spin up a local Prometheus instance against your TV without manual setup:

```bash
./scripts/run-prometheus.sh <tv-ip> [<tv-ip2> ...]
```

It downloads a standalone Prometheus binary into `~/.cache/glasshouse-prometheus/` if one is not in PATH, starts a server targeting your TV(s) at `http://localhost:9090`, and cleans up its temporary state when stopped.

## Metrics

These names are stable: one is not renamed or removed, so dashboards and alerts built on them keep working. Labels carry only values that rarely change. Values are in base units: bytes, hertz, seconds, and ratios from 0 to 1 rather than percentages. A reading the TV does not give, such as the panel figures on an LCD or the remote's battery with no remote paired, has no sample rather than a 0.

`version` is the Glasshouse version. A label the TV does not report is present with an empty value. The panel usage since the last compensation cycle is `glasshouse_oled_panel_usage_seconds_total - glasshouse_oled_last_compensation_usage_seconds`, the uptime is `time() - glasshouse_boot_time_seconds`, and the processor's busy share is `1 - avg without (cpu, mode) (rate(glasshouse_cpu_seconds_total{mode="idle"}[5m]))`.

| Metric                                            | Type    | Labels                                  | Value                                                       |
| :------------------------------------------------ | :------ | :-------------------------------------- | :---------------------------------------------------------- |
| `glasshouse_info`                                 | gauge   | `model`, `firmware`, `webos`, `version` | 1                                                           |
| `glasshouse_boot_time_seconds`                    | gauge   |                                         | When the TV last booted, as a Unix time                     |
| `glasshouse_system_on`                            | gauge   |                                         | 1 when on, including with the screen off                    |
| `glasshouse_screen_on`                            | gauge   |                                         | 1 when the screen is on, including a screen saver           |
| `glasshouse_soc_temperature_celsius`              | gauge   |                                         | SoC temperature                                             |
| `glasshouse_cpu_seconds_total`                    | counter | `cpu`, `mode`                           | Time each online core has spent in each mode                |
| `glasshouse_cpu_frequency_hertz`                  | gauge   |                                         | Processor clock                                             |
| `glasshouse_gpu_frequency_hertz`                  | gauge   |                                         | GPU clock                                                   |
| `glasshouse_memory_total_bytes`                   | gauge   |                                         | `MemTotal`                                                  |
| `glasshouse_memory_available_bytes`               | gauge   |                                         | `MemAvailable`                                              |
| `glasshouse_swap_total_bytes`                     | gauge   |                                         | `SwapTotal`                                                 |
| `glasshouse_swap_free_bytes`                      | gauge   |                                         | `SwapFree`                                                  |
| `glasshouse_network_receive_bytes_total`          | counter | `interface`                             | Bytes received on the interface in use                      |
| `glasshouse_network_transmit_bytes_total`         | counter | `interface`                             | Bytes sent on the interface in use                          |
| `glasshouse_wifi_signal_dbm`                      | gauge   |                                         | Wi-Fi signal level                                          |
| `glasshouse_wifi_link_quality`                    | gauge   |                                         | Wi-Fi link quality, on the driver's own scale               |
| `glasshouse_emmc_pre_eol_state`                   | gauge   | `state`                                 | 1 for the current eMMC state: `normal`, `warning`, `urgent` |
| `glasshouse_emmc_life_used_ratio`                 | gauge   | `type`                                  | eMMC estimated life used, in steps of 0.1                   |
| `glasshouse_app_storage_size_bytes`               | gauge   |                                         | Size of the app storage filesystem                          |
| `glasshouse_app_storage_available_bytes`          | gauge   |                                         | Space available there for new apps                          |
| `glasshouse_remote_battery_ratio`                 | gauge   |                                         | Magic Remote battery                                        |
| `glasshouse_adblock_enabled`                      | gauge   |                                         | 1 when ad blocking is in place                              |
| `glasshouse_oled_panel_usage_seconds_total`       | counter |                                         | Time the panel has been in use                              |
| `glasshouse_oled_last_compensation_usage_seconds` | gauge   |                                         | Panel usage at the last short compensation cycle            |
| `glasshouse_oled_compensation_interval_seconds`   | gauge   |                                         | Panel usage between short compensation cycles               |
| `glasshouse_oled_compensation_running`            | gauge   |                                         | 1 while a short compensation cycle runs                     |
| `glasshouse_oled_compensation_runs_total`         | counter |                                         | Short compensation cycles completed                         |
| `glasshouse_oled_last_refresher_usage_seconds`    | gauge   |                                         | Panel usage at the last Pixel Refresher run                 |
| `glasshouse_oled_refresher_interval_seconds`      | gauge   |                                         | Panel usage between automatic Pixel Refresher runs          |
| `glasshouse_oled_refresher_runs_total`            | counter |                                         | Pixel Refresher runs completed                              |
| `glasshouse_oled_failure_alerts_total`            | counter |                                         | Panel maintenance failure alerts recorded                   |
