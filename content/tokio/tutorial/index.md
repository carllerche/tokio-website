---
title: "Tutorial"
subtitle: "Setup"
---

This tutorial will take you step by step through the process of building a
[Redis] client and server. We will start with the basics of asynchronous
programming with Rust and build up from there. We will implement a subset of
Redis commands but will get a comprehensive tour of Tokio.

# Mini-Redis

The project that you will build in this tutorial is available as [Mini-Redis on
GitHub][mini-redis]. Mini-Redis is designed with the primary goal of learning
Tokio, and is therefore very well commented, but this also means that Mini-Redis
is missing some features you would want in a real Redis library. You can find
production-ready Redis libraries on [crates.io](https://crates.io/).

We will use Mini-Redis directly in the tutorial. This allows us to use parts of
Mini-Redis in the tutorial before we implement them later in the tutorial.

# Getting Help

At any point, if you get stuck, you can always get help on [Discord] or [GitHub
discussions][disc]. Don't worry about asking "beginner" questions. We all start
somewhere and are happy to help.

[discord]: https://discord.gg/tokio
[disc]: https://github.com/tokio-rs/tokio/discussions

# Prerequisites

Readers should already be familiar with [Rust]. The [Rust book][book] is an
excellent resource to get started with.

While not required, some experience with writing networking code using the [Rust
standard library][std] or another language can be helpful.

No pre-existing knowledge of Redis is required.

[rust]: https://rust-lang.org
[book]: https://doc.rust-lang.org/book/
[std]: https://doc.rust-lang.org/std/

## Rust

Before getting started, you should make sure that you have the
[Rust][install-rust] toolchain installed and ready to go. If you don't have it,
the easiest way to install it is using [rustup].

This tutorial requires a minimum of Rust version `1.70.0`, but the most
recent stable version of Rust is recommended.

To check that Rust is installed on your computer, run the following:

```bash
rustc --version
```

You should see output like `rustc 1.81.0 (eeb90cda1 2024-09-04)`.

## Mini-Redis server

Next, install the Mini-Redis server. This will be used to test our client as we
build it.

```bash
cargo install mini-redis
```

Make sure that it was successfully installed by starting the server:

```bash
mini-redis-server
```

Then, in a separate terminal window, try to get the key `foo` using `mini-redis-cli`

```bash
mini-redis-cli get foo
```

You should see `(nil)`.

# Ready to go

That's it, everything is ready to go. Go to the next page to write your first
asynchronous Rust application.

[redis]: https://redis.io
[mini-redis]: https://github.com/tokio-rs/mini-redis
[install-rust]: https://www.rust-lang.org/tools/install
[rustup]: https://rustup.rs/
