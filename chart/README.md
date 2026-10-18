# sample-nodejs Helm chart

Deploys the Express app as a **Deployment**: it has no persistent storage or
stable pod identity requirements, so a StatefulSet is unnecessary. Prometheus
counters are process-local and reset when a pod restarts; aggregate across pods
when querying metrics.

## Install

From the repository root:

```sh
npm run docker:build
helm upgrade --install sample-nodejs ./chart --namespace sample-nodejs --create-namespace
helm test sample-nodejs --namespace sample-nodejs
kubectl --namespace sample-nodejs port-forward service/sample-nodejs 8080:8080
```

Visit `http://127.0.0.1:8080/my-app`. The app has no `/` route.

The default image is `sample-nodejs:latest`, matching the npm build script, with
`IfNotPresent` pull policy. A local image must be loaded into the cluster's image
store (for example with kind or minikube); building on the host alone may not make
it available to Kubernetes. For remote clusters, push the image to a registry and
override `image.repository` and `image.tag`. Use immutable tags in CI; reused
`latest` images with `IfNotPresent` can remain cached on nodes. Configure
`imagePullSecrets` for a private registry.

## Configuration

| Value | Default | Purpose |
| --- | --- | --- |
| `replicaCount` | `1` | Replicas when autoscaling is disabled |
| `image.repository` | `sample-nodejs` | Application image repository |
| `image.tag` | `latest` | Image tag; an empty value uses chart appVersion (`1.0.0`) |
| `containerPort` | `8080` | Container port and application `PORT` environment variable |
| `service.port` | `8080` | Service port, independently configurable from the container port |
| `service.type` | `ClusterIP` | Internal service by default |
| `ingress.enabled` | `false` | Optional Ingress; configure class, host and TLS |
| `httpRoute.enabled` | `false` | Optional Gateway API route; requires Gateway API and a Gateway controller |
| `metrics.enabled` | `true` | Add Prometheus scrape annotations to application pods |
| `serviceAccount.automount` | `false` | App does not need Kubernetes API credentials |
| `autoscaling.enabled` | `false` | Optional CPU-based HPA; requires the resource metrics API |

The service targets the named `http` container port. Changing `containerPort`
also updates `PORT` and the generated metrics port annotation. Custom
`podAnnotations` override generated annotations. Disabling `metrics.enabled`
removes generated scrape annotations, not the app's `/metrics` endpoint.

Startup and liveness probes use `/live`; readiness uses `/ready`. These simple
endpoints report process health, not external dependency health. Requests default
to 100m CPU / 64Mi memory; limits default to 500m CPU / 128Mi memory. Tune them
against actual usage. Containers run as UID/GID 1000 with a read-only root
filesystem, dropped capabilities, and privilege escalation disabled.

Ingress and HTTPRoute default to routing only `/my-app` on `sample-nodejs.local`,
without path rewriting. Enable one and configure its controller and DNS for your
environment. Add routes explicitly if `/about` should be public. Routing `/`
would also expose `/classified`, `/metrics`, and health endpoints; restricting
routes is not authentication and does not protect direct in-cluster access.

Metrics annotations require a Prometheus configuration that discovers annotated
pods. This chart does not install Prometheus or a ServiceMonitor CRD.

## Validate

```sh
helm lint ./chart --strict
helm template sample-nodejs ./chart
```

The Helm test checks `/ready`, `/my-app`, and `/metrics` through the Service.