---
title: "Next steps with Tracing"
---

# Tokio-console

[`tokio-console`](https://github.com/tokio-rs/console) is an htop-like utility that enables you to see a real-time view
of an application’s spans and events. It can also represent "resources" that the
Tokio runtime has created, such as Tasks. It's essential for understanding
performance issues during the development process.

For instance, to use tokio-console in [the mini-redis project](https://github.com/tokio-rs/mini-redis),
you need to enable the `tracing` feature for the Tokio package:

```bash
cargo add tokio --features full,tracing
```

Note: The `full` feature doesn't enable `tracing`.

You'll also need to add a dependency on the `console-subscriber` package. This
crate provides a `Subscriber` implementation that will replace the one currently
used by mini-redis:

```bash
cargo add console-subscriber
```

Finally, in `src/bin/server.rs`, replace the call to `tracing_subscriber` with
the call to `console-subscriber`:

Replace this:

```rust
# use std::error::Error;
tracing_subscriber::fmt::try_init()?;
# Ok::<(), Box<dyn Error + Send + Sync + 'static>>(())
```

...with this:

```rust
console_subscriber::init();
```

This will enable the `console_subscriber`, which means that any instrumentation
relevant to `tokio-console` will be recorded. Logging to stdout will still
happen (based on the value of the `RUST_LOG` environment variable).

Now we should be ready to start up mini-redis again, this time using the
`tokio_unstable` flag (which is needed to enable tracing):

```sh
RUSTFLAGS="--cfg tokio_unstable" cargo run --bin mini-redis-server
```

The `tokio_unstable` flag allows us to make use of additional APIs provided by
Tokio which do not currently have a guarantee of stability (in other words,
breaking changes are allowed for these APIs).

All that is remaining is to run the console itself in another terminal. The
easiest way to do that would be to install it from crates.io:

```sh
cargo install --locked tokio-console
```

and then run it with:

```sh
tokio-console
```

The initial view you will see is for tokio Tasks that are currently running.
Example: ![tokio-console Task
view](https://raw.githubusercontent.com/tokio-rs/console/main/assets/tasks_list.png)

It can also show Tasks for a period of time after they have completed (the color
for these will be grey). You can generate some traces by running the mini-redis
hello world example (this is available in the [mini-redis
repository](https://github.com/tokio-rs/mini-redis)):

```sh
cargo run --example hello_world
```

If you press `r`, you can switch to the Resources view. This displays
semaphores, mutexes, and other constructs that are being used by the Tokio
runtime. Example: ![tokio-console Resource
view](https://raw.githubusercontent.com/tokio-rs/console/main/assets/resources.png)

Whenever you need to introspect the Tokio runtime to understand the performance
of you application better, you can make use of tokio-console to view what is
happening in real time, helping you to spot deadlocks and other issues.

To learn more about how to use tokio-console, please visit [its documentation
page](https://docs.rs/tokio-console/latest/tokio_console/#using-the-console).

# Integrating with OpenTelemetry

[OpenTelemetry](https://opentelemetry.io/) (OTel) means multiple things; for
one, it's an open specification, defining a data model for traces and metrics
that can handle the needs of most users. It is also a set of language-specific
SDKs, providing instrumentation so that traces and metrics can be emitted from
an application. Thirdly, there is the OpenTelemetry Collector, a binary that
runs alongside your application to collect the traces and metrics, ultimately
pushing those out to a telemetry vendor, such as DataDog, Honeycomb, or AWS
X-Ray. It can also send data to tools such as Prometheus instead.

The [opentelemetry crate](https://crates.io/crates/opentelemetry) is what
provides the OpenTelemetry SDK for Rust, and is what we will be using for this
tutorial.

In this tutorial, we will be setting up mini-redis to send data to
[Jaeger](https://www.jaegertracing.io/), which is a UI for visualizing traces.

To run an instance of Jaeger, you can use Docker:

```sh
docker run -d -p6831:6831/udp -p6832:6832/udp -p16686:16686 -p14268:14268 jaegertracing/all-in-one:latest
```

You can visit the Jaeger page by going to <http://localhost:16686>.
It will look like this:
![Jaeger UI](/img/tracing-next-steps/jaeger-first-pageload.png)

We'll come back to this page once we have some trace data generated and sent.

To set up mini-redis, we'll first need to add a few dependencies. Add the
following dependencies to your `Cargo.toml` file:

```bash
# Implements the types defined in the Otel spec
cargo add opentelemetry
# Integration between the tracing crate and the opentelemetry crate
cargo add tracing-opentelemetry
# Allows you to export data to Jaeger
cargo add opentelemetry-jaeger
```

Now, in `src/bin/server.rs`, add the following imports:

```rust
use opentelemetry::global;
use tracing_subscriber::{
    fmt, layer::SubscriberExt, util::SubscriberInitExt,
};
```

We will look at what each of these do in a moment.

The next step is to replace the call to `tracing_subscriber` with the OTel
setup.

Replace this:

```rust
# use std::error::Error;
tracing_subscriber::fmt::try_init()?;
# Ok::<(), Box<dyn Error + Send + Sync + 'static>>(())
```

...with this:

```rust
# use std::error::Error;
# use opentelemetry::global;
# use tracing_subscriber::{
#     fmt, layer::SubscriberExt, util::SubscriberInitExt,
# };
// Allows you to pass along context (i.e., trace IDs) across services
global::set_text_map_propagator(opentelemetry_jaeger::Propagator::new());
// Sets up the machinery needed to export data to Jaeger
// There are other OTel crates that provide pipelines for the vendors
// mentioned earlier.
let tracer = opentelemetry_jaeger::new_pipeline()
    .with_service_name("mini-redis")
    .install_simple()?;

// Create a tracing layer with the configured tracer
let opentelemetry = tracing_opentelemetry::layer().with_tracer(tracer);

// The SubscriberExt and SubscriberInitExt traits are needed to extend the
// Registry to accept `opentelemetry (the OpenTelemetryLayer type).
tracing_subscriber::registry()
    .with(opentelemetry)
    // Continue logging to stdout
    .with(fmt::Layer::default())
    .try_init()?;
# Ok::<(), Box<dyn Error + Send + Sync + 'static>>(())
```

Now you should be able to start up mini-redis:

```sh
cargo run --bin mini-redis-server
```

In another terminal, run the hello world example (this is available in the
[mini-redis repository](https://github.com/tokio-rs/mini-redis)):

```sh
cargo run --example hello_world
```

Now, refresh the Jaeger UI that we had open, and on the main Search page, find
"mini-redis" as one of the options in the Service dropdown.

Select that option, and click the "Find Traces" button. This should show the
request we just made from running the example.
![Jaeger UI, mini-redis overview](/img/tracing-next-steps/jaeger-mini-redis-overview.png)

Clicking on the trace should show you a detailed view of the spans that were
emitted during the handling of the hello world example.
![Jaeger UI, mini-redis request details](/img/tracing-next-steps/jaeger-mini-redis-trace-details.png)

That's it for now! You can explore this further by sending more requests, adding
additional instrumentation for mini-redis, or setting up OTel with a telemetry
vendor (instead of the Jaeger instance we are running locally). For this last
one, you might need to pull in an additional crate (for example, for sending
data to the OTel Collector, you'll need the `opentelemetry-otlp` crate). There
are many examples available in the [opentelemetry-rust
repository](https://github.com/open-telemetry/opentelemetry-rust/tree/main/examples).

Note: The mini-redis repo already contains a full example of OpenTelemetry with
AWS X-Ray, details of which can be found in the
[`README`](https://github.com/tokio-rs/mini-redis#aws-x-ray-example), as well as
the
[`Cargo.toml`](https://github.com/tokio-rs/mini-redis/blob/24d9d9f466d9078c46477bf5c2d68416553b9872/Cargo.toml#L35-L41)
and
[`src/bin/server.rs`](https://github.com/tokio-rs/mini-redis/blob/24d9d9f466d9078c46477bf5c2d68416553b9872/src/bin/server.rs#L59-L94)
files.
