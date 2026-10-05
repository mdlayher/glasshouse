# Prometheus

The server can answer Prometheus scrapes at `/api/prometheus/metrics`, in the text exposition format. It is off by default, and while it is off the path does not exist: a request gets 404.

## Switching it on

On the dashboard's **Server** tab (`/?tab=server`), switch **Metrics endpoint** to **On**. It applies at once, without a restart.

In `config.json`:

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

## Metrics

These names are stable: one is not renamed or removed, so dashboards and alerts built on them keep working. Labels carry only values that rarely change.

| Metric            | Type  | Labels                                  | Value |
| :---------------- | :---- | :-------------------------------------- | :---- |
| `glasshouse_info` | gauge | `model`, `firmware`, `webos`, `version` | 1     |

`version` is the Glasshouse version. A label the TV does not report is present with an empty value.
