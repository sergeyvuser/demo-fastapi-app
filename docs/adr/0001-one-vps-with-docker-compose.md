# One VPS with docker compose, not a PaaS and not Kubernetes

This project runs thirteen containers — six application services plus Postgres, Redis, RabbitMQ,
Prometheus, Grafana, Jaeger and a reverse proxy — on a single 4 GB VPS described by
`compose.yaml` plus a production overlay. A PaaS was priced first: platforms bill per
always-on service, six of ours never sleep, and none of the candidates offered managed RabbitMQ, so
the same system came to roughly $70 a month against roughly 700 ₽ here — and the honest way to fit
the PaaS budget would have been to drop the observability stack, which is one of the things this
project exists to demonstrate. Kubernetes was rejected on the other axis: it would add a control
plane, its own failure modes and a second thing to learn, in exchange for capabilities (self-healing
across nodes, rolling updates, autoscaling) that a single-host demo cannot use.

## Consequences

- **One host is one failure domain.** If the machine goes, the service goes; recovery is a rebuild
  plus a restore, not a failover. This is why the backups in `deploy/backup.sh` leave the machine
  weekly, and why the restore path is exercised rather than assumed.
- **A deploy costs seconds of downtime.** Containers are recreated in place; there is no second
  replica to shift traffic to, and no zero-downtime story.
- **Operations are ours.** Host patching, disk, memory limits, TLS renewal and log rotation have no
  provider behind them. Every container therefore carries an explicit memory limit, sized against
  `memory.stat` rather than against `docker stats`.
- **Nothing here is Kubernetes-shaped.** Service discovery is docker's network, configuration is env
  files, and the proxy is a Caddyfile. A future migration would rewrite all three rather than
  translate them.
