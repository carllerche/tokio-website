---
title: Cargo Feature Flags
---

When depending on Tokio for the tutorial, the `full` feature flag was enabled:

```toml
tokio = { version = "1", features = ["full"] }
```

Tokio has a lot of functionality (TCP, UDP, Unix sockets, timers, sync utilities, multiple scheduler
types, etc). Not all applications need all functionality. When attempting to optimize compile time
or the end application footprint, the application can decide to opt into **only** the features it
uses.

More information about the available flags is available in the API docs at:
<https://docs.rs/tokio/latest/tokio/#feature-flags>
